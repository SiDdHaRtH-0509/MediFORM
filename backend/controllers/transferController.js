const crypto = require('crypto');
const Transfer = require('../models/Transfer');
const AuditLog = require('../models/AuditLog');
const IdempotencyRecord = require('../models/IdempotencyRecord');

// Helper for patient ownership / IDOR check
function isAuthorizedForPatient(user, pid) {
  if (user.role === 'doctor') return true;
  // Patient users can only access records matching their username or patient ID
  if (user.role === 'patient') {
    const userPid = (user.username || '').toLowerCase();
    const targetPid = (pid || '').toLowerCase();
    return userPid === targetPid || targetPid.includes(userPid);
  }
  return false;
}

// Create new Transfer (Doctor only) with Idempotency Key Handling
exports.createTransfer = async (req, res) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey;
    const {
      pid, nam, age, gender, bg, dob, contactNumber, emergencyContact, address,
      fh, th, rt, priority = 'Routine', referringDoctor, receivingDepartment, transferDateTime,
      pd, secondaryDiagnosis, currentCondition, sum,
      alg = [], noKnownAllergies = false, med = [], vit, pi = [], otherDetails = []
    } = req.body;

    if (!pid || !nam || !age || !bg || !fh || !th || !rt || !pd) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'Required identity, transfer, and clinical fields are missing.' }
      });
    }

    // Compute canonical request hash
    const canonicalPayload = JSON.stringify({ pid, nam, age, bg, fh, th, rt, pd });
    const requestHash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    if (idempotencyKey) {
      const existingKeyRecord = await IdempotencyRecord.findOne({ idempotencyKey });
      if (existingKeyRecord) {
        // Test 2: Same key + different authenticated doctor -> rejected with HTTP 403
        if (existingKeyRecord.userId.toString() !== req.user.userId.toString()) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN_IDEMPOTENCY_KEY', message: 'Idempotency key belongs to a different doctor account.' }
          });
        }

        // Test 3: Same doctor + same key + materially different payload -> rejected with HTTP 409
        if (existingKeyRecord.requestHash !== requestHash) {
          return res.status(409).json({
            success: false,
            error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency key reused with materially different transfer payload.' }
          });
        }

        // Test 1: Same doctor + same key + same request -> return stored original result
        return res.status(201).json(existingKeyRecord.responsePayload);
      }
    }

    const newTransfer = new Transfer({
      pid, nam, age, gender, bg, dob, contactNumber, emergencyContact, address,
      fh, th, rt, priority, referringDoctor, receivingDepartment,
      transferDateTime: transferDateTime ? new Date(transferDateTime) : new Date(),
      pd, secondaryDiagnosis, currentCondition, sum,
      alg, noKnownAllergies, med, vit, pi, otherDetails,
      issuerUserId: req.user.userId,
      issuerUsername: req.user.username,
      status: 'IN_TRANSIT',
      acknowledgementStatus: 'PENDING',
      isCurrent: true,
      version: 1,
      history: [{
        action: 'TRANSFER_CREATED',
        timestamp: new Date(),
        doctorUsername: req.user.username,
        hospital: fh,
        version: 1,
        notes: `Transfer created with priority ${priority}`
      }]
    });

    await newTransfer.save();

    await AuditLog.create({
      action: 'TRANSFER_CREATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { transferId: newTransfer._id, pid: newTransfer.pid, priority }
    });

    const responsePayload = {
      success: true,
      transfer: newTransfer
    };

    if (idempotencyKey) {
      try {
        await IdempotencyRecord.create({
          idempotencyKey,
          userId: req.user.userId,
          requestHash,
          responsePayload,
          transferId: newTransfer._id
        });
      } catch (idempotencyErr) {
        // Race condition handling: clean up redundant transfer created concurrently
        await Transfer.findByIdAndDelete(newTransfer._id);
        
        let racerRecord = await IdempotencyRecord.findOne({ idempotencyKey, userId: req.user.userId });
        let attempts = 0;
        while (!racerRecord && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 50));
          racerRecord = await IdempotencyRecord.findOne({ idempotencyKey, userId: req.user.userId });
          attempts++;
        }
        if (racerRecord) {
          return res.status(201).json(racerRecord.responsePayload);
        }
      }
    }

    return res.status(201).json(responsePayload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Retrieve single transfer by ID (with authorization check)
exports.getTransferById = async (req, res) => {
  try {
    const { id } = req.params;
    const transfer = await Transfer.findById(id);

    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transfer record not found.' }
      });
    }

    // Patient IDOR protection check
    if (!isAuthorizedForPatient(req.user, transfer.pid)) {
      await AuditLog.create({
        action: 'UNAUTHORIZED_TRANSFER_ACCESS',
        actorId: req.user ? req.user.userId : null,
        actorRole: req.user ? req.user.role : 'anonymous',
        details: { targetPid: transfer.pid, transferId: transfer._id }
      });
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ACCESS', message: 'Unauthorized access to target patient record.' }
      });
    }

    return res.status(200).json({
      success: true,
      transfer
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Immutable Version Update (Doctor only)
exports.updateTransfer = async (req, res) => {
  try {
    const { id } = req.params;
    const oldTransfer = await Transfer.findById(id);

    if (!oldTransfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Target transfer record not found.' }
      });
    }

    if (!oldTransfer.isCurrent) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_VERSION', message: 'Cannot update a non-current historical version.' }
      });
    }

    // Set old transfer isCurrent to false
    oldTransfer.isCurrent = false;
    await oldTransfer.save();

    const updateData = req.body;
    const newVersionNumber = oldTransfer.version + 1;

    const recipientUserIds = oldTransfer.recipientUserIds || [];
    const recipientUsernames = oldTransfer.recipientUsernames || [];

    const newHistory = [
      ...oldTransfer.history,
      {
        action: 'TRANSFER_UPDATED',
        timestamp: new Date(),
        doctorUsername: req.user.username,
        hospital: updateData.fh || oldTransfer.fh,
        version: newVersionNumber,
        notes: 'Transfer medical record updated'
      }
    ];

    const updatedTransfer = new Transfer({
      ...oldTransfer.toObject(),
      ...updateData,
      _id: undefined,
      version: newVersionNumber,
      previousVersionId: oldTransfer._id,
      isCurrent: true,
      status: 'UPDATED',
      history: newHistory,
      recipientUserIds,
      recipientUsernames,
      submittedAt: new Date()
    });

    await updatedTransfer.save();

    await AuditLog.create({
      action: 'TRANSFER_UPDATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { previousVersionId: oldTransfer._id, newVersionId: updatedTransfer._id, version: newVersionNumber }
    });

    await AuditLog.create({
      action: 'TRANSFER_VERSION_CREATED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { transferId: updatedTransfer._id, version: newVersionNumber, previousVersionId: oldTransfer._id }
    });

    return res.status(200).json({
      success: true,
      transfer: updatedTransfer
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Receiver Acknowledgement (Doctor only)
exports.acknowledgeTransfer = async (req, res) => {
  try {
    const { id } = req.params;
    const { arrivalCondition, arrivalNotes = '', discrepancies = [] } = req.body;

    if (!arrivalCondition || !['Stable', 'Unstable'].includes(arrivalCondition)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Arrival condition must be "Stable" or "Unstable".' }
      });
    }

    const transfer = await Transfer.findById(id);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transfer record not found.' }
      });
    }

    const hasDiscrepancies = discrepancies && discrepancies.length > 0;
    const newStatus = hasDiscrepancies ? 'DISCREPANCY' : 'RECEIVED';

    transfer.status = newStatus;
    transfer.acknowledgementStatus = 'ACKNOWLEDGED';
    transfer.acknowledgement = {
      acknowledgedByUserId: req.user.userId,
      acknowledgedByUsername: req.user.username,
      arrivalCondition,
      arrivalNotes,
      discrepancies,
      acknowledgedAt: new Date()
    };

    if (!transfer.recipientUserIds.includes(req.user.userId)) {
      transfer.recipientUserIds.push(req.user.userId);
    }
    if (!transfer.recipientUsernames.includes(req.user.username)) {
      transfer.recipientUsernames.push(req.user.username);
    }

    transfer.history.push({
      action: hasDiscrepancies ? 'ACKNOWLEDGED_WITH_DISCREPANCY' : 'ACKNOWLEDGED_STABLE',
      timestamp: new Date(),
      doctorUsername: req.user.username,
      hospital: req.user.hospitalName || 'Receiving Hospital',
      version: transfer.version,
      notes: `Arrival condition: ${arrivalCondition}. ${hasDiscrepancies ? `Discrepancies: ${discrepancies.join(', ')}` : 'No discrepancies reported.'}`
    });

    await transfer.save();

    await AuditLog.create({
      action: 'TRANSFER_ACKNOWLEDGED',
      actorId: req.user.userId,
      actorRole: req.user.role,
      details: { transferId: transfer._id, status: newStatus, arrivalCondition, discrepancies }
    });

    return res.status(200).json({
      success: true,
      transfer
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Scan Event Audit
exports.recordScanEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const transfer = await Transfer.findById(id);
    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Transfer record not found.' }
      });
    }

    if (req.user && req.user.role === 'doctor') {
      if (!transfer.recipientUserIds.includes(req.user.userId)) {
        transfer.recipientUserIds.push(req.user.userId);
      }
      if (!transfer.recipientUsernames.includes(req.user.username)) {
        transfer.recipientUsernames.push(req.user.username);
      }
      await transfer.save();
    }

    await AuditLog.create({
      action: 'QR_SCANNED_EVENT',
      actorId: req.user ? req.user.userId : null,
      actorRole: req.user ? req.user.role : 'anonymous',
      details: { transferId: transfer._id, pid: transfer.pid }
    });

    return res.status(200).json({
      success: true,
      message: 'Scan event logged.'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Get current active version for patient ID (with IDOR protection)
exports.getCurrentByPid = async (req, res) => {
  try {
    const { pid } = req.params;

    if (!isAuthorizedForPatient(req.user, pid)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ACCESS', message: 'Unauthorized access to target patient record.' }
      });
    }

    const currentTransfer = await Transfer.findOne({ pid, isCurrent: true }).sort({ createdAt: -1 });

    if (!currentTransfer) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `No active transfer found for Patient ID ${pid}.` }
      });
    }

    return res.status(200).json({
      success: true,
      transfer: currentTransfer
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Patient Timeline (with IDOR protection)
exports.getPatientTimeline = async (req, res) => {
  try {
    const { pid } = req.params;

    if (!isAuthorizedForPatient(req.user, pid)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN_ACCESS', message: 'Unauthorized access to target patient record.' }
      });
    }

    const transfers = await Transfer.find({ pid }).sort({ version: 1, submittedAt: 1 });

    return res.status(200).json({
      success: true,
      pid,
      totalVersions: transfers.length,
      timeline: transfers
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Doctor Issued History
exports.getDoctorIssuedHistory = async (req, res) => {
  try {
    const transfers = await Transfer.find({ issuerUserId: req.user.userId }).sort({ updatedAt: -1 });
    return res.status(200).json({
      success: true,
      transfers
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};

// Recipient Scanned History
exports.getRecipientScannedHistory = async (req, res) => {
  try {
    const transfers = await Transfer.find({ recipientUserIds: req.user.userId }).sort({ updatedAt: -1 });
    return res.status(200).json({
      success: true,
      transfers
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
};
