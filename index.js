const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { User, Report } = require('./models'); // make sure models.js exists
const dotenv = require('dotenv');

dotenv.config();
const app = express();

// --- Hardcoded constants ---
const PORT = 5000;

// MongoDB URI
const MONGO_URI = process.env.MONGO_URI; // why is it undefined

// Frontend URLs allowed via CORS
const allowedOrigins = [
  'http://localhost:3000',                // local dev
  process.env.FRONTEND_URL                     // production frontend from env,
];

// --- Middleware ---
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // allow Postman or server requests
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS not allowed'));
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));

// --- Health Check ---
app.get('/', (req, res) => {
  res.send('BugTracker API is running 🚀');
});

// --- Database Connection & Server Start ---
const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB Connected Successfully');
    
    // Seed default developer
    await seedDatabase();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
};

// --- Seed Default Developer ---
const seedDatabase = async () => {
  try {
    const devExists = await User.findOne({ username: 'hasan' });
    if (!devExists) {
      const hashedPassword = await bcrypt.hash('dev', 10);
      await User.create({
        id: 'u_dev',
        name: 'Hasan',
        username: 'hasan',
        password: hashedPassword,
        role: 'developer'
      });
      console.log('👤 Default developer account created: Hasan (username: hasan, password: dev)');
    } else {
      console.log('ℹ️  Default developer already exists');
    }
  } catch (err) {
    console.error('⚠️ Seeding error:', err.message);
  }
};

// --- Routes ---

// Auth
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const { password: _, ...userSafe } = user.toObject();
    res.json(userSafe);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Users
app.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/users', async (req, res) => {
  try {
    const { name, username, password, role } = req.body;
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: 'Username taken' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      id: 'u_' + Math.random().toString(36).substr(2, 9),
      name,
      username,
      password: hashedPassword,
      role
    });

    const { password: _, ...userSafe } = newUser.toObject();
    res.json(userSafe);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/users/:id/reset-password', async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash('1234', 10);
    await User.findOneAndUpdate({ id: req.params.id }, { password: hashedPassword });
    res.json({ success: true, message: 'Password reset to 1234' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reports
app.get('/reports', async (req, res) => {
  try {
    const reports = await Report.find().sort({ createdAt: -1 });
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/reports/:id', async (req, res) => {
  try {
    const report = await Report.findOne({ id: req.params.id });
    if (!report) return res.status(404).json({ error: 'Not found' });
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/reports', async (req, res) => {
  try {
    const reportData = req.body;
    const newReport = await Report.create({
      ...reportData,
      id: Math.random().toString(36).substr(2, 9),
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: []
    });
    res.json(newReport);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/reports/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const report = await Report.findOneAndUpdate(
      { id: req.params.id },
      { status, updatedAt: new Date().toISOString() },
      { new: true }
    );
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/reports/:id/assign', async (req, res) => {
  try {
    const { assignedToId, assignedToName } = req.body;
    const report = await Report.findOneAndUpdate(
      { id: req.params.id },
      { assignedToId, assignedToName, updatedAt: new Date().toISOString() },
      { new: true }
    );
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/reports/:id/comments', async (req, res) => {
  try {
    const { authorId, authorName, message } = req.body;
    const comment = {
      id: Math.random().toString(36).substr(2, 9),
      authorId,
      authorName,
      message,
      timestamp: new Date().toISOString()
    };

    await Report.findOneAndUpdate(
      { id: req.params.id },
      { $push: { comments: comment } },
      { new: true }
    );
    res.json(comment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Start the backend ---
connectDB();
