const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const mongoose = require('mongoose');

const authRoutes = require('./routes/authRoutes');
const transferRoutes = require('./routes/transferRoutes');
const qrRoutes = require('./routes/qrRoutes');
const userRoutes = require('./routes/userRoutes');
const screeningRoutes = require('./routes/screeningRoutes');
const referralRoutes = require('./routes/referralRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const followUpRoutes = require('./routes/followUpRoutes');
const monitoringRoutes = require('./routes/monitoringRoutes');
const consentRoutes = require('./routes/consentRoutes');
const doctorRoutes = require('./routes/doctorRoutes');
const verificationRoutes = require('./routes/verificationRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');

const app = express();

// Trust reverse proxy (Render, Cloudflare, Vercel, AWS ALB) for accurate multi-hospital IP rate-limiting
app.set('trust proxy', 1);

// Security Body Size Limit (Configurable via MAX_JSON_BODY_SIZE, default 10mb for credentials & document uploads)
const bodyLimit = process.env.MAX_JSON_BODY_SIZE || '10mb';
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// CORS & HTTP Security Headers
const allowedOrigins = process.env.NODE_ENV === 'production' && process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : '*';

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-QR-UUID', 'X-QR-PIN', 'X-Request-Id']
}));

app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
  next();
});

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = dbStates[mongoose.connection.readyState] || 'unknown';
  res.status(200).json({
    status: 'OK',
    service: 'MediFORM Digital Transfer API',
    company: 'COLIN Tech',
    database: dbState,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/user', userRoutes);
app.use('/api/screenings', screeningRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/follow-ups', followUpRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/consent', consentRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/verifications', verificationRoutes);
app.use('/api/subscriptions', subscriptionRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Requested API endpoint does not exist.' }
  });
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  const isPayloadTooLarge = err.type === 'entity.too.large' || err.status === 413;
  if (isPayloadTooLarge) {
    return res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: `Request payload exceeds the maximum allowed limit of ${bodyLimit}.`
      }
    });
  }

  const statusCode = err.status || 500;
  res.status(statusCode).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected error occurred on the server.'
    }
  });
});

module.exports = app;
