require('dotenv').config();
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('./app');

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mediform';

async function startServer() {
  try {
    console.log('Attempting to connect to MongoDB at:', MONGODB_URI);
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('Successfully connected to MongoDB server.');
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      console.error('FATAL: Unable to connect to production MongoDB database:', err.message);
      process.exit(1);
    }
    console.log('Local MongoDB not available. Launching fallback in-memory MongoDB database for development...');
    const mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
    console.log('Successfully connected to In-Memory MongoDB at:', mongoUri);
  }

  app.listen(PORT, () => {
    console.log(`MediFORM API server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start MediFORM server:', err);
  process.exit(1);
});
