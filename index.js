const dotenv = require('dotenv');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { User, Report } = require('./models');

dotenv.config();
const admin = require('./firebaseAdmin');
const app = express();
const PORT = process.env.PORT || 5000;
const allowedOrigins = [
  'http://localhost:3000',
  process.env.FRONTEND_URL
];

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/', (req, res) => res.send('BugTracker API 🚀'));

// Save FCM token
app.post('/users/fcm-token', async (req, res) => {
  const { userId, token } = req.body;
  await User.findOneAndUpdate({ id: userId }, { fcmToken: token });
  res.json({ success: true });
});

// Auth
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const { password: _, ...userSafe } = user.toObject();
    res.json(userSafe);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Users
app.get('/users', async (req, res) => {
  try { const users = await User.find({}, '-password'); res.json(users); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/users', async (req, res) => {
  try {
    const { name, username, password, role } = req.body;
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ error: 'Username taken' });

    const hashed = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      id: 'u_' + Math.random().toString(36).substr(2, 9),
      name, username, password: hashed, role
    });
    const { password: _, ...safeUser } = newUser.toObject();
    res.json(safeUser);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/users/:id/reset-password', async (req, res) => {
  try {
    const hashed = await bcrypt.hash('1234', 10);
    await User.findOneAndUpdate({ id: req.params.id }, { password: hashed });
    res.json({ success: true, message: 'Password reset to 1234' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reports
app.get('/reports', async (req, res) => {
  try { const reports = await Report.find().sort({ createdAt: -1 }); res.json(reports); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/reports/:id', async (req, res) => {
  try {
    const report = await Report.findOne({ id: req.params.id });
    if (!report) return res.status(404).json({ error: 'Not found' });
    res.json(report);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create report & notify developers
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

    // Notify all developers
    const devs = await User.find({ role: 'developer', fcmToken: { $ne: null } });
    const messages = devs.map(d => ({
      token: d.fcmToken,
      notification: {
        title: 'New Bug Reported',
        body: `#${newReport.id}: ${newReport.app}`,
      },
      data: { reportId: newReport.id, type: 'new_report' }
    }));
    if (messages.length > 0) await admin.messaging().sendAll(messages);

    res.json(newReport);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update report status & notify creator
app.put('/reports/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const report = await Report.findOneAndUpdate(
      { id: req.params.id },
      { status, updatedAt: new Date().toISOString() },
      { new: true }
    );

    const creator = await User.findOne({ id: report.createdBy, fcmToken: { $ne: null } });
    if (creator) {
      await admin.messaging().send({
        token: creator.fcmToken,
        notification: {
          title: 'Report Status Updated',
          body: `Your report #${report.id} is now ${status.replace('_',' ')}`,
        },
        data: { reportId: report.id, type: 'status_update' }
      });
    }

    res.json(report);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Assign report & notify assignee
app.put('/reports/:id/assign', async (req, res) => {
  try {
    const { assignedToId, assignedToName } = req.body;
    const report = await Report.findOneAndUpdate(
      { id: req.params.id },
      { assignedToId, assignedToName, updatedAt: new Date().toISOString() },
      { new: true }
    );

    const assignee = await User.findOne({ id: assignedToId, fcmToken: { $ne: null } });
    if (assignee) {
      await admin.messaging().send({
        token: assignee.fcmToken,
        notification: {
          title: 'Report Assigned',
          body: `You have been assigned report #${report.id}`,
        },
        data: { reportId: report.id, type: 'assigned' }
      });
    }

    res.json(report);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add comment & notify other party
app.post('/reports/:id/comments', async (req, res) => {
  try {
    const { authorId, authorName, message } = req.body;
    const comment = {
      id: Math.random().toString(36).substr(2, 9),
      authorId, authorName, message,
      timestamp: new Date().toISOString()
    };

    const report = await Report.findOneAndUpdate(
      { id: req.params.id },
      { $push: { comments: comment }, updatedAt: new Date().toISOString() },
      { new: true }
    );

    // Notify opposite party
    let notifyUser;
    if (authorId === report.createdBy && report.assignedToId) {
      notifyUser = await User.findOne({ id: report.assignedToId, fcmToken: { $ne: null } });
    } else if (authorId !== report.createdBy) {
      notifyUser = await User.findOne({ id: report.createdBy, fcmToken: { $ne: null } });
    }

    if (notifyUser) {
      await admin.messaging().send({
        token: notifyUser.fcmToken,
        notification: {
          title: 'New Comment',
          body: `${authorName} commented on report #${report.id}`,
        },
        data: { reportId: report.id, type: 'comment' }
      });
    }

    res.json(comment);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Seed default developer
const seedDatabase = async () => {
  const dev = await User.findOne({ username: 'hasan' });
  if (!dev) {
    const hashed = await bcrypt.hash('dev', 10);
    await User.create({
      id: 'u_dev', name: 'Hasan', username: 'hasan',
      password: hashed, role: 'developer'
    });
    console.log('👤 Default developer created');
  }
};

// Connect DB & start server
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB Connected');
    await seedDatabase();
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
};

connectDB();
