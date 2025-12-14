const mongoose = require('mongoose');

// Define Schema only once
const UserSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: { type: String },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['developer', 'user'], default: 'user' }
});

const CommentSchema = new mongoose.Schema({
  id: String,
  authorId: String,
  authorName: String,
  message: String,
  timestamp: String
});

const ReportSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  reporterId: String,
  reporterName: String,
  app: String,
  page: String,
  url: String,
  description: String,
  screenshots: [String], // Base64 strings
  severity: { type: String, enum: ['low', 'medium', 'high'] },
  status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
  assignedToId: String,
  assignedToName: String,
  createdAt: String,
  updatedAt: String,
  comments: [CommentSchema]
});

// Check if model exists before compiling to avoid OverwriteModelError in some dev environments
const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Report = mongoose.models.Report || mongoose.model('Report', ReportSchema);

module.exports = { User, Report };