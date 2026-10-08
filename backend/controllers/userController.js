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
    const { hospitalName } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
    }

    if (hospitalName && user.role === 'doctor') {
      user.hospitalName = hospitalName;
    }
    await user.save();

    return res.status(200).json({
      success: true,
      profile: {
        id: user._id,
        username: user.username,
        role: user.role,
        hospitalName: user.hospitalName
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
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
