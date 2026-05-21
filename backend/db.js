/**
 * db.js — Mongoose models for ClassBoard
 *
 * Storage optimization strategy:
 *  • Sessions collection: metadata only (no snapshot blobs inline)
 *  • Snapshots collection: one per session (the latest / final), ~30-80 KB each
 *  • Folders collection: lightweight folder metadata
 *
 * This replaces the file-based sessions.json (~7 MB) with a proper DB.
 */
const mongoose = require("mongoose");

// ─── Session ─────────────────────────────────────────────────────────────────
const sessionSchema = new mongoose.Schema(
  {
    code:          { type: String, required: true, unique: true, index: true, uppercase: true },
    title:         { type: String, default: "Untitled Class" },
    createdBy:     String,
    teacherEmail:  { type: String, lowercase: true },
    createdAt:     { type: Date, default: Date.now },
    endedAt:       { type: Date, default: null },
    active:        { type: Boolean, default: true, index: true },
    folder:        { type: String, default: "" },
    participants:  [{ name: String, email: String, role: String }],
    permBans:      [{ type: String, lowercase: true }], // banned emails
    snapshotCount: { type: Number, default: 0 },
  },
  { versionKey: false }
);

// ─── Snapshot ─────────────────────────────────────────────────────────────────
// Stored separately to keep Session documents tiny.
// We keep at most ONE snapshot per session: the final one (or latest if not ended).
const snapshotSchema = new mongoose.Schema(
  {
    sessionCode: { type: String, required: true, index: true, uppercase: true },
    dataURL:     { type: String, required: true }, // base64 JPEG (optimized quality)
    timestamp:   { type: Date, default: Date.now },
    isFinal:     { type: Boolean, default: false },
  },
  { versionKey: false }
);

// ─── Folder ───────────────────────────────────────────────────────────────────
const folderSchema = new mongoose.Schema(
  {
    folderId:  { type: String, required: true, unique: true },
    name:      { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

// ─── User ─────────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true },
    email:    { type: String, required: true, unique: true, lowercase: true },
    name:     { type: String, required: true },
    picture:  { type: String, default: '' },
    role:     { type: String, enum: ['admin','teacher','student'], default: 'teacher' },
    createdAt:{ type: Date, default: Date.now },
  },
  { versionKey: false }
);

// ─── Models ───────────────────────────────────────────────────────────────────
const Session  = mongoose.model('Session',  sessionSchema);
const Snapshot = mongoose.model('Snapshot', snapshotSchema);
const Folder   = mongoose.model('Folder',   folderSchema);
const User     = mongoose.model('User',     userSchema);

// ─── Connect ─────────────────────────────────────────────────────────────────
async function connectDB() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) {
    console.warn("⚠️  MONGODB_URI / MONGO_URL not set — running in memory-only mode (data lost on restart)");
    return; // Don't crash — just skip DB
  }
  await mongoose.connect(uri, { dbName: "classboard" });
  console.log("✅ MongoDB connected");
}

module.exports = { connectDB, Session, Snapshot, Folder, User };
