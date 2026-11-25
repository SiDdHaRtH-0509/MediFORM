const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config();
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('./app');
const { startFollowUpScheduler } = require('./services/followUpSchedulerService');
const { startMonitoringScheduler } = require('./services/referralMonitoringService');

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mediform';

function validateProductionEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('2026')) {
      console.warn('[SECURITY WARNING] Default JWT_SECRET detected in production. Set a strong unique JWT_SECRET in your environment.');
    }
    if (!process.env.ENCRYPTION_KEY && !process.env.AES_SECRET_KEY) {
      console.warn('[SECURITY WARNING] Default ENCRYPTION_KEY detected in production. Set a 32-byte ENCRYPTION_KEY in your environment.');
    }
  }
}

let serverInstance = null;
let memoryServerInstance = null;

async function startServer() {
  validateProductionEnvironment();
  const isPlaceholderUri = MONGODB_URI.includes('<db_username>') || MONGODB_URI.includes('<password>');

  const mongoOptions = {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 25,
    minPoolSize: 5,
    socketTimeoutMS: 45000
  };

  if (!isPlaceholderUri) {
    try {
      console.log('Attempting to connect to MongoDB...');
      await mongoose.connect(MONGODB_URI, mongoOptions);
      console.log('Successfully connected to MongoDB server (pool size 5-25).');
    } catch (err) {
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MEMORY_FALLBACK !== 'true') {
        throw new Error(`Production MongoDB connection failed: ${err.message}`);
      }
      console.warn(`Primary MongoDB URI connection failed (${err.message}). Falling back to In-Memory MongoDB...`);
      await startInMemoryDatabase();
    }
  } else {
    console.log('Placeholder MONGODB_URI detected. Launching In-Memory MongoDB database...');
    await startInMemoryDatabase();
  }

  if (process.env.SEED_DEMO_DATA === 'true') {
    try {
      const { seedData } = require('./scripts/seedDemoData');
      await seedData();
    } catch (seedErr) {
      console.error('Seed demo data error:', seedErr.message);
    }
  }

  serverInstance = app.listen(PORT, () => {
    console.log(`MediFORM API server (COLIN Tech) running on port ${PORT}`);
    startFollowUpScheduler();
    console.log('Automated Follow-Up Reminder & Status Scheduler initiated.');
    startMonitoringScheduler();
    console.log('Intelligent Referral Handoff & Risk Monitoring Scheduler initiated.');
  });
}

async function startInMemoryDatabase() {
  memoryServerInstance = await MongoMemoryServer.create();
  const mongoUri = memoryServerInstance.getUri();
  await mongoose.connect(mongoUri);
  console.log('Successfully connected to In-Memory MongoDB at:', mongoUri);
}

async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Gracefully shutting down MediFORM API...`);
  if (serverInstance) {
    await new Promise(resolve => serverInstance.close(resolve));
  }
  await mongoose.connection.close().catch(() => {});
  if (memoryServerInstance) {
    await memoryServerInstance.stop().catch(() => {});
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer().catch((err) => {
  console.error('Failed to start MediFORM server:', err);
  process.exit(1);
});
