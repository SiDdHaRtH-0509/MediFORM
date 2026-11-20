const User = require('../models/User');

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User profile not found.' } });
    }
    return res.status(200).json({ success: true, profile: user });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { hospitalName, specialization, department } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    }

    if (user.role === 'doctor') {
      if (hospitalName) user.hospitalName = hospitalName.trim();
      if (specialization) user.specialization = specialization.trim();
      if (department) user.department = department.trim();
    }
    await user.save();

    return res.status(200).json({
      success: true,
      profile: {
        id: user._id,
        username: user.username,
        role: user.role,
        hospitalName: user.hospitalName,
        specialization: user.specialization,
        department: user.department
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
};

/**
 * Doctor Directory: Search and filter registered eligible doctors
 */
exports.getDoctorsDirectory = async (req, res) => {
  try {
    const { search, specialization, hospital } = req.query;
    const query = { role: 'doctor' };

    if (search && search.trim()) {
      const s = search.trim();
      query.$or = [
        { name: new RegExp(s, 'i') },
        { username: new RegExp(s, 'i') },
        { email: new RegExp(s, 'i') }
      ];
    }

    if (specialization && specialization.trim()) {
      query.specialization = new RegExp(`^${specialization.trim()}$`, 'i');
    }

    if (hospital && hospital.trim()) {
      query.hospitalName = new RegExp(hospital.trim(), 'i');
    }

    const doctors = await User.find(query)
      .select('_id name username email hospitalName specialization department isEmailVerified verificationStatus yearsOfExperience professionalDesignation createdAt')
      .sort({ name: 1, hospitalName: 1 });

    return res.status(200).json({
      success: true,
      count: doctors.length,
      doctors: doctors.map(doc => ({
        id: doc._id,
        doctorId: doc._id,
        name: doc.name || doc.username,
        username: doc.username,
        email: doc.email,
        hospital: doc.hospitalName,
        hospitalName: doc.hospitalName,
        specialization: doc.specialization || 'General Medicine',
        department: doc.department || 'Emergency / Triage',
        isEmailVerified: Boolean(doc.isEmailVerified),
        verificationStatus: doc.verificationStatus || 'UNVERIFIED',
        isVerified: doc.verificationStatus === 'VERIFIED',
        yearsOfExperience: doc.yearsOfExperience || 0,
        professionalDesignation: doc.professionalDesignation || ''
      }))
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: err.message || 'Error retrieving doctor directory.' }
    });
  }
};

exports.deleteProfile = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.user.userId);
    return res.status(200).json({ success: true, message: 'User profile deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
};
