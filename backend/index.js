require('dotenv').config();
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('./app');

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

  app.listen(PORT, () => {
    console.log(`MediFORM API server running on http://localhost:${PORT}`);
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
