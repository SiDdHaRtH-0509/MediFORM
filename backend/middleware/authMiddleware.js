const jwt = require('jsonwebtoken');
const User = require('../models/User');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication token required.' }
    });
  }

  const secret = process.env.JWT_SECRET || 'mediform_super_secret_jwt_key_2026';
  jwt.verify(token, secret, async (err, decoded) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Invalid or expired token.' }
      });
    }

    try {
      const user = await User.findById(decoded.userId);
      if (!user) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'User account no longer exists.' }
        });
      }

      // Token Versioning check: token is invalidated if user's tokenVersion in DB is higher
      const dbTokenVersion = user.tokenVersion || 0;
      const tokenVersionInJwt = decoded.tokenVersion || 0;
      if (dbTokenVersion !== tokenVersionInJwt) {
        return res.status(403).json({
          success: false,
          error: { code: 'TOKEN_REVOKED', message: 'Session invalidated due to password reset or security update. Please log in again.' }
        });
      }

      req.user = decoded;
      req.currentUser = user;
      next();
    } catch (dbErr) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Database error verifying authentication session.' }
      });
    }
  });
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_ROLE',
          message: `Operation restricted to ${role} role only.`
        }
      });
    }
    next();
  };
}

module.exports = {
  authenticateToken,
  requireRole
};
