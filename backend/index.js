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

async function startServer() {
  const isPlaceholderUri = MONGODB_URI.includes('<db_username>') || MONGODB_URI.includes('<password>');

  if (!isPlaceholderUri) {
    try {
      console.log('Attempting to connect to MongoDB at:', MONGODB_URI);
      await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
      console.log('Successfully connected to MongoDB server.');
    } catch (err) {
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

  app.listen(PORT, () => {
    console.log(`MediFORM API server running on http://localhost:${PORT}`);
    startFollowUpScheduler();
    console.log('Automated Follow-Up Reminder & Status Scheduler initiated.');
    startMonitoringScheduler();
    console.log('Intelligent Referral Handoff & Risk Monitoring Scheduler initiated.');
  });
}

async function startInMemoryDatabase() {
  const mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
  console.log('Successfully connected to In-Memory MongoDB at:', mongoUri);
}

startServer().catch((err) => {
  console.error('Failed to start MediFORM server:', err);
  process.exit(1);
});
