const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const transferRoutes = require('./routes/transferRoutes');
const qrRoutes = require('./routes/qrRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

// Security Body Size Limit (Configurable via MAX_JSON_BODY_SIZE, default 250kb)
const bodyLimit = process.env.MAX_JSON_BODY_SIZE || '250kb';
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// CORS & HTTP Security Headers
const allowedOrigins = process.env.NODE_ENV === 'production' && process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : '*';

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key']
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
  next();
});

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'MediFORM Digital Transfer API',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/user', userRoutes);

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
