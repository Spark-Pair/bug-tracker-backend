require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const { User, Report } = require('./models');

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:3000',
  'https://bug-tracker-psi-ten.vercel.app'
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
app.use(express.json());

// Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}

// --------------------
// Health
// --------------------
app.get('/', (req, res) => res.send('BugTracker API 🚀'));

// --------------------
// Auth
// --------------------
app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const { password: _, ...userSafe } = user.toObject();
    res.json(userSafe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// Users
// --------------------
app.get('/users', async (req, res) => {
  try { 
    const users = await User.find({}, '-password'); 
    res.json(users); 
  } catch (err) { res.status(500).json({ error: err.message }); }
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

app.post('/users/fcm-token', async (req, res) => {
  try {
    const { userId, token } = req.body;
    if (!userId || !token) return res.status(400).json({ error: 'userId and token required' });

    const user = await User.findOneAndUpdate(
      { id: userId },
      { fcmToken: token },
      { new: true }
    );

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ success: true, userId: user.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/users/:id/reset-password', async (req, res) => {
  try {
    const hashed = await bcrypt.hash('1234', 10);
    await User.findOneAndUpdate({ id: req.params.id }, { password: hashed });
    res.json({ success: true, message: 'Password reset to 1234' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --------------------
// Reports
// --------------------
app.get('/reports', async (req, res) => {
  try { 
    const reports = await Report.find().sort({ createdAt: -1 }); 
    res.json(reports); 
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/reports/:id', async (req, res) => {
  try {
    const report = await Report.findOne({ id: req.params.id });
    if (!report) return res.status(404).json({ error: 'Not found' });
    res.json(report);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/reports', async (req, res) => {
  try {
    const report = await Report.create(req.body);

    // Notify all developers
    const developers = await User.find({ role: 'developer', fcmToken: { $exists: true, $ne: null } });
    const tokens = developers.map(d => d.fcmToken);

    if (tokens.length) {
      const message = {
        notification: {
          title: 'New Bug Reported',
          body: `#${report.id}: ${report.app}`
        },
        tokens
      };
      try {
        if (tokens.length) {
          const message = { notification: { title: 'New Bug', body: report.app }, tokens };
          await admin.messaging().sendMulticast(message);
        }
      } catch (err) {
        console.error('FCM sendMulticast error:', err.message);
      }
    }

    res.json(report);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/reports/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const report = await Report.findOneAndUpdate(
      { id: req.params.id },
      { status, updatedAt: new Date().toISOString() },
      { new: true }
    );

    const creator = await User.findOne({ id: report.reporterId, fcmToken: { $ne: null } });
    if (creator) {
      await admin.messaging().send({
        token: creator.fcmToken,
        notification: {
          title: 'Report Status Updated',
          body: `Your report #${report.id} is now ${status.replace('_',' ')}`
        }
      });
    }

    res.json(report);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
          body: `You have been assigned report #${report.id}`
        }
      });
    }

    res.json(report);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
    if (authorId === report.reporterId && report.assignedToId) {
      notifyUser = await User.findOne({ id: report.assignedToId, fcmToken: { $ne: null } });
    } else if (authorId !== report.reporterId) {
      notifyUser = await User.findOne({ id: report.reporterId, fcmToken: { $ne: null } });
    }

    if (notifyUser) {
      await admin.messaging().send({
        token: notifyUser.fcmToken,
        notification: {
          title: 'New Comment',
          body: `${authorName} commented on report #${report.id}`
        }
      });
    }

    res.json(comment);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --------------------
// DB & Server Start
// --------------------
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB Connected');
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => console.error(err));
