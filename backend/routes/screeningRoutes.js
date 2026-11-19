const express = require('express');
const router = express.Router();
const screeningController = require('../controllers/screeningController');
const { authenticateToken, requireRole } = require('../middleware/authMiddleware');
const { transferLimiter } = require('../middleware/rateLimiter');

router.use(transferLimiter);
router.use(authenticateToken);

// Create new screening assessment (Doctor only)
router.post('/', requireRole('doctor'), screeningController.createScreening);

// Get Flagged Screenings (Quick triage view)
router.get('/flagged', screeningController.getFlaggedScreenings);

// Get All Screenings (Auth required, IDOR protected)
router.get('/', screeningController.getAllScreenings);

// Get Screening by ID (Auth required, IDOR protected)
router.get('/:id', screeningController.getScreeningById);

module.exports = router;
