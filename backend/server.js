const express = require("express");
const cors    = require("cors");
const http    = require("http");
const { Server } = require("socket.io");
const path    = require("path");
const dotenv  = require("dotenv");

dotenv.config({ path: "../.env" });

const mongoose = require("mongoose");
const jwt     = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { connectDB, Session, Snapshot, Folder, User, getDbStatus } = require("./db");


const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  pingTimeout: 60000,
  maxHttpBufferSize: 5e7,          // 50 MB (was 100 MB — reduced since we optimise quality)
  cors: { origin: "*" },
  connectionStateRecovery: {},
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TEACHER_EMAIL  = (process.env.TEACHER_EMAIL  || "itsvikash143@gmail.com").toLowerCase();
const ADMIN_EMAILS   = (process.env.ADMIN_EMAILS   || TEACHER_EMAIL).toLowerCase().split(",").map(e => e.trim());
const JWT_SECRET     = process.env.JWT_SECRET      || "classboard_dev_secret_change_in_prod";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient   = new OAuth2Client(GOOGLE_CLIENT_ID);
const PORT           = process.env.PORT || 3001;

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
// Reads Bearer JWT from Authorization header, attaches req.user if valid.
// Routes that call requireAuth will return 401 if the token is missing/invalid.
const requireAuth = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (mongoose.connection.readyState === 1) {
      const dbUser = await User.findOne({ googleId: decoded.googleId });
      if (dbUser) {
        if (dbUser.isBanned) {
          const reason = dbUser.banReason ? ` Reason: ${dbUser.banReason}` : "";
          return res.status(403).json({ error: `You are permanently banned from ClassBoard.${reason}` });
        }
        if (dbUser.banExpiresAt && new Date(dbUser.banExpiresAt) > new Date()) {
          const reason = dbUser.banReason ? ` Reason: ${dbUser.banReason}` : "";
          const expires = new Date(dbUser.banExpiresAt).toLocaleString();
          return res.status(403).json({ error: `You are temporarily banned until ${expires}.${reason}` });
        }
        req.user = dbUser;
      } else {
        req.user = decoded;
      }
    } else {
      req.user = decoded;
    }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }
  next();
};

// Optional auth — attaches req.user if token present, never rejects
const optionalAuth = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch {}
  }
  next();
};

// ─── IN-MEMORY ROOM STATE ─────────────────────────────────────────────────────
// rooms[code] = { code, title, teacher, members, canvasState, chats[],
//                 classLocked, mutedIds: Set, tempBans: Map }
const rooms = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Helper: upsert a snapshot (keep only 1 per session) — skips gracefully if no DB
async function saveSnapshot(sessionCode, dataURL, isFinal = false) {
  if (mongoose.connection.readyState !== 1) return; // no DB connected
  await Snapshot.findOneAndUpdate(
    { sessionCode },
    { dataURL, timestamp: new Date(), isFinal },
    { upsert: true, new: true }
  );
  await Session.updateOne({ code: sessionCode }, { $set: { snapshotCount: 1 } });
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

// POST /api/auth/google — exchange Google ID token for ClassBoard JWT (GIS flow)
app.post("/api/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: "credential required" });
    const ticket  = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;
    const role = ADMIN_EMAILS.includes(email.toLowerCase()) ? "admin" : "teacher";
    if (mongoose.connection.readyState === 1) {
      const existingUser = await User.findOne({ googleId });
      if (existingUser) {
        if (existingUser.isBanned) {
          const reason = existingUser.banReason ? ` Reason: ${existingUser.banReason}` : "";
          return res.status(403).json({ error: `You are permanently banned from ClassBoard.${reason}` });
        }
        if (existingUser.banExpiresAt && new Date(existingUser.banExpiresAt) > new Date()) {
          const reason = existingUser.banReason ? ` Reason: ${existingUser.banReason}` : "";
          const expires = new Date(existingUser.banExpiresAt).toLocaleString();
          return res.status(403).json({ error: `You are temporarily banned until ${expires}.${reason}` });
        }
      }
      await User.findOneAndUpdate(
        { googleId }, { email, name, picture, role },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    const token = jwt.sign({ googleId, email, name, picture, role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { googleId, email, name, picture, role } });
  } catch (err) {
    console.error("Google auth error:", err.message);
    res.status(401).json({ error: "Google authentication failed" });
  }
});

// ── Standard OAuth 2.0 redirect flow (more reliable — no JS origin check) ────
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://classroom-eight.vercel.app").trim();
const BACKEND_URL  = (process.env.BACKEND_URL  || "https://classboard-production-9f4d.up.railway.app").trim();

app.get("/api/auth/google/url", (req, res) => {
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  `${BACKEND_URL}/api/auth/google/callback`,
    response_type: "code",
    scope:         "openid email profile",
    access_type:   "online",
    prompt:        "select_account",
  });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});

// GET /api/auth/google/callback — Google redirects HERE (backend)
// Exchanges code → JWT → redirects browser to frontend with token in URL
app.get("/api/auth/google/callback", async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) return res.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent(error)}`);
    if (!code) return res.redirect(`${FRONTEND_URL}?auth_error=no_code`);

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  `${BACKEND_URL}/api/auth/google/callback`,
        grant_type:    "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.id_token) throw new Error(tokenData.error_description || "No id_token");

    // Verify ID token, build user
    const ticket  = await googleClient.verifyIdToken({ idToken: tokenData.id_token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;
    const role = ADMIN_EMAILS.includes(email.toLowerCase()) ? "admin" : "teacher";

    if (mongoose.connection.readyState === 1) {
      const existingUser = await User.findOne({ googleId });
      if (existingUser) {
        if (existingUser.isBanned) {
          const reason = existingUser.banReason ? ` Reason: ${existingUser.banReason}` : "";
          return res.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent("You are permanently banned from ClassBoard." + reason)}`);
        }
        if (existingUser.banExpiresAt && new Date(existingUser.banExpiresAt) > new Date()) {
          const reason = existingUser.banReason ? ` Reason: ${existingUser.banReason}` : "";
          const expires = new Date(existingUser.banExpiresAt).toLocaleString();
          return res.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent("You are temporarily banned until " + expires + "." + reason)}`);
        }
      }
      await User.findOneAndUpdate(
        { googleId }, { email, name, picture, role },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    const token = jwt.sign({ googleId, email, name, picture, role }, JWT_SECRET, { expiresIn: "7d" });

    // Redirect browser back to frontend with JWT in URL param
    const dest = `${FRONTEND_URL.replace(/\/$/, "")}?cb_token=${encodeURIComponent(token)}`;
    res.redirect(dest);
  } catch (err) {
    console.error("OAuth callback error:", err.message);
    res.redirect(`${FRONTEND_URL}?auth_error=${encodeURIComponent(err.message)}`);
  }
});


// GET /api/auth/me — verify JWT and return current user
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/demo — fallback login when Google OAuth isn't configured
// Issues a real JWT based on name+email (no Google verification).
// Admin emails (ADMIN_EMAILS) still receive the admin role.
app.post("/api/auth/demo", async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) return res.status(400).json({ error: "name and email required" });

    const normalEmail = email.toLowerCase().trim();
    const role = ADMIN_EMAILS.includes(normalEmail) ? "admin" : "teacher";
    const googleId = `demo_${normalEmail.replace(/[^a-z0-9]/g, "_")}`;

    // Upsert user in DB if available
    if (mongoose.connection.readyState === 1) {
      const existingUser = await User.findOne({ googleId });
      if (existingUser) {
        if (existingUser.isBanned) {
          const reason = existingUser.banReason ? ` Reason: ${existingUser.banReason}` : "";
          return res.status(403).json({ error: `You are permanently banned from ClassBoard.${reason}` });
        }
        if (existingUser.banExpiresAt && new Date(existingUser.banExpiresAt) > new Date()) {
          const reason = existingUser.banReason ? ` Reason: ${existingUser.banReason}` : "";
          const expires = new Date(existingUser.banExpiresAt).toLocaleString();
          return res.status(403).json({ error: `You are temporarily banned until ${expires}.${reason}` });
        }
      }
      await User.findOneAndUpdate(
        { googleId },
        { email: normalEmail, name, picture: "", role },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    const token = jwt.sign(
      { googleId, email: normalEmail, name, picture: "", role, demo: true },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({
      token,
      user: { googleId, email: normalEmail, name, picture: "", role },
      warning: "Demo mode — configure GOOGLE_CLIENT_ID for Google OAuth",
    });
  } catch (err) {
    console.error("demo auth error:", err.message);
    res.status(500).json({ error: "Login failed" });
  }
});


// ─── ADMIN API ROUTES ──────────────────────────────────────────────────────────

// Get all registered teachers/users
app.get("/api/admin/teachers", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database not connected" });
    }
    const users = await User.find({}).sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    console.error("Fetch teachers error:", err.message);
    res.status(500).json({ error: "Failed to fetch teachers" });
  }
});

// Ban/Unban teacher
app.post("/api/admin/teachers/:googleId/ban", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { googleId } = req.params;
    const { isBanned, banExpiresAt, banReason } = req.body;
    
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database not connected" });
    }
    
    // Prevent admin self-banning
    if (googleId === req.user.googleId) {
      return res.status(400).json({ error: "Cannot ban your own account" });
    }

    const updatedUser = await User.findOneAndUpdate(
      { googleId },
      { 
        isBanned: !!isBanned, 
        banExpiresAt: banExpiresAt ? new Date(banExpiresAt) : null,
        banReason: banReason || ""
      },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ message: "User status updated successfully", user: updatedUser });
  } catch (err) {
    console.error("Ban teacher error:", err.message);
    res.status(500).json({ error: "Failed to update user status" });
  }
});

// Delete teacher account
app.delete("/api/admin/teachers/:googleId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { googleId } = req.params;
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database not connected" });
    }
    
    if (googleId === req.user.googleId) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }

    const deletedUser = await User.findOneAndDelete({ googleId });
    if (!deletedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ message: "User account deleted successfully" });
  } catch (err) {
    console.error("Delete teacher error:", err.message);
    res.status(500).json({ error: "Failed to delete teacher account" });
  }
});

// Edit session metadata
app.put("/api/admin/sessions/:code", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const { title, active, folder } = req.body;
    
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database not connected" });
    }

    const session = await Session.findOneAndUpdate(
      { code: code.toUpperCase() },
      { title, active, folder },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Update in-memory room active status / title if currently live
    const room = rooms[code.toUpperCase()];
    if (room) {
      if (title !== undefined) room.title = title;
      if (active === false) {
        room.endedAt = new Date();
      }
    }

    res.json({ message: "Session updated successfully", session });
  } catch (err) {
    console.error("Edit session error:", err.message);
    res.status(500).json({ error: "Failed to update session" });
  }
});

// Delete session and its snapshot
app.delete("/api/admin/sessions/:code", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const cleanCode = code.toUpperCase();
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: "Database not connected" });
    }

    const deletedSession = await Session.findOneAndDelete({ code: cleanCode });
    if (!deletedSession) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Delete snapshots
    await Snapshot.deleteMany({ sessionCode: cleanCode });

    // Remove from in-memory rooms if live
    delete rooms[cleanCode];

    res.json({ message: "Session and snapshots deleted successfully" });
  } catch (err) {
    console.error("Delete session error:", err.message);
    res.status(500).json({ error: "Failed to delete session" });
  }
});


// ─── REST API ─────────────────────────────────────────────────────────────────

// Diagnose database connection issues
app.get("/api/db-status", (req, res) => {
  res.json(getDbStatus());
});

// List sessions — filtered by teacher ownership (admin sees all)
app.get("/api/sessions", optionalAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json([]); // Return empty list in memory-only mode
    }

    // Admin sees everything; teachers see only their sessions; guests see nothing
    let filter = {};
    if (req.user) {
      if (req.user.role !== "admin") {
        filter = { teacherEmail: req.user.email };
      }
    } else {
      return res.json([]); // unauthenticated — no sessions listed
    }

    const sessions = await Session.find(
      filter,
      "code title createdBy teacherEmail createdAt endedAt active folder snapshotCount participants"
    ).lean().sort({ createdAt: -1 });

    res.json(sessions.map(s => ({
      code:             s.code,
      title:            s.title,
      createdBy:        s.createdBy,
      teacherEmail:     s.teacherEmail,
      createdAt:        s.createdAt,
      endedAt:          s.endedAt,
      active:           s.active,
      folder:           s.folder || "",
      snapshotCount:    s.snapshotCount || 0,
      participantCount: (s.participants || []).length,
    })));
  } catch (e) {
    console.error("GET /api/sessions:", e.message);
    res.status(500).json({ error: "DB error" });
  }
});

// Get single session + its snapshot (for replay)
app.get("/api/sessions/:code", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    if (mongoose.connection.readyState !== 1) {
      // Memory-only fallback: check in-memory rooms
      const room = rooms[code];
      if (!room) return res.status(404).json({ error: "Session not found" });
      return res.json({
        code,
        title: room.title,
        createdBy: room.teacher.name,
        teacherEmail: room.teacher.email,
        createdAt: new Date(),
        active: room.active,
        folder: "",
        snapshots: room.canvasState ? [{ timestamp: new Date(), dataURL: room.canvasState }] : [],
      });
    }

    const session = await Session.findOne({ code }).lean();
    if (!session) return res.status(404).json({ error: "Session not found" });

    const snap = await Snapshot.findOne({ sessionCode: code }).lean();
    res.json({
      ...session,
      snapshots: snap ? [{ timestamp: snap.timestamp, dataURL: snap.dataURL }] : [],
    });
  } catch (e) {
    console.error("GET /api/sessions/:code:", e.message);
    res.status(500).json({ error: "DB error" });
  }
});

// Update session folder
app.patch("/api/sessions/:code/folder", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true, folder: req.body.folder || "" });
    }

    const updated = await Session.findOneAndUpdate(
      { code },
      { folder: req.body.folder || "" },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({ success: true, folder: updated.folder });
  } catch (e) {
    res.status(500).json({ error: "DB error" });
  }
});

// Delete one session — owner or admin only
app.delete("/api/sessions/:code", optionalAuth, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true });
    }

    const session = await Session.findOne({ code }).lean();
    if (!session) return res.status(404).json({ error: "Not found" });

    // Access check: must be admin OR the teacher who created it
    if (req.user) {
      const isAdmin   = req.user.role === "admin";
      const isOwner   = session.teacherEmail === req.user.email;
      if (!isAdmin && !isOwner) return res.status(403).json({ error: "Forbidden" });
    } else {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await Session.deleteOne({ code });
    await Snapshot.deleteMany({ sessionCode: code });
    console.log(`Session ${code} deleted by ${req.user?.email}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "DB error" });
  }
});

// Bulk delete
app.post("/api/sessions/bulk-delete", async (req, res) => {
  try {
    const { codes } = req.body;
    if (!Array.isArray(codes) || codes.length === 0)
      return res.status(400).json({ error: "codes array required" });

    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true, deleted: codes.length });
    }

    const upper = codes.map(c => c.toUpperCase());
    await Session.deleteMany({ code: { $in: upper } });
    await Snapshot.deleteMany({ sessionCode: { $in: upper } });
    res.json({ success: true, deleted: codes.length });
  } catch (e) {
    res.status(500).json({ error: "DB error" });
  }
});

// ─── Folders ──────────────────────────────────────────────────────────────────

app.get("/api/folders", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json([]); // Return empty list in memory-only mode
    }

    const folders = await Folder.find({}).lean().sort({ createdAt: 1 });
    res.json(folders.map(f => ({ id: f.folderId, name: f.name })));
  } catch (e) {
    res.status(500).json({ error: "DB error" });
  }
});

app.post("/api/folders", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name required" });

    if (mongoose.connection.readyState !== 1) {
      return res.json({ id: Date.now().toString(), name });
    }

    const id     = Date.now().toString();
    const folder = await Folder.create({ folderId: id, name });
    res.json({ id: folder.folderId, name: folder.name });
  } catch (e) {
    res.status(500).json({ error: "DB error" });
  }
});

app.patch("/api/folders/:id", async (req, res) => {
  try {
    const { id }   = req.params;
    const { name } = req.body;

    if (mongoose.connection.readyState !== 1) {
      return res.json({ id, name });
    }

    const folder   = await Folder.findOne({ folderId: id });
    if (!folder) return res.status(404).json({ error: "Folder not found" });
    const oldName  = folder.name;
    folder.name    = name;
    await folder.save();
    // Rename folder reference on all sessions
    await Session.updateMany({ folder: oldName }, { folder: name });
    res.json({ id: folder.folderId, name: folder.name });
  } catch (e) {
    res.status(500).json({ error: "DB error" });
  }
});

app.delete("/api/folders/:id", async (req, res) => {
  try {
    const { id }  = req.params;

    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true });
    }

    const folder  = await Folder.findOne({ folderId: id });
    if (!folder) return res.status(404).json({ error: "Folder not found" });
    const oldName = folder.name;
    await folder.deleteOne();
    await Session.updateMany({ folder: oldName }, { folder: "" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "DB error" });
  }
});

// ─── Serve frontend in production ─────────────────────────────────────────────
const __dirname1 = path.resolve();
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname1, "./frontend/build")));
  app.get("*", (req, res) =>
    res.sendFile(path.resolve(__dirname1, "frontend", "build", "index.html"))
  );
} else {
  app.get("/", (req, res) => res.send("ClassBoard API running"));
}

// ─── SOCKET.IO ───────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  // ── Create a new class session (teacher only) ─────────────────────────────
  socket.on("create-session", async ({ name, email, title }) => {
    const code = generateCode();

    // In-memory room
    rooms[code] = {
      code,
      title: title || "Untitled Class",
      teacher:     { id: socket.id, name, email },
      members:     [{ id: socket.id, name, email, role: "teacher" }],
      canvasState: null,
      chats:       [],
      active:      true,
      classLocked: false,
      mutedIds:    new Set(),
      tempBans:    new Map(),
    };

    // Persist to MongoDB (lightweight — no snapshot yet)
    try {
      if (mongoose.connection.readyState === 1) {
        await Session.create({
          code,
          title:        title || "Untitled Class",
          createdBy:    name,
          teacherEmail: (email || "").toLowerCase(),
          createdAt:    new Date(),
          active:       true,
          participants: [{ name, email, role: "teacher" }],
        });
      }
    } catch (e) {
      console.error("create-session DB error:", e.message);
    }

    socket.join(code);
    socket.emit("session-created", { code, room: rooms[code] });
    console.log(`Session created: ${code} by ${name}`);
  });

  // ── Join an existing session ───────────────────────────────────────────────
  socket.on("join-session", async ({ name, email, code }) => {
    const roomCode = code.toUpperCase();
    const room     = rooms[roomCode];

    // Look up persisted session
    let persisted;
    try {
      persisted = await Session.findOne({ code: roomCode }).lean();
    } catch (e) {
      console.error("join-session DB error:", e.message);
    }

    if (!room && !persisted) {
      socket.emit("error-msg", { msg: `No session found with code "${roomCode}".` });
      return;
    }

    // ── Not in memory (server restarted or ended session) ─────────────────────
    if (!room) {
      const isTeacherReconnect = email && email.toLowerCase() === TEACHER_EMAIL;

      if (isTeacherReconnect && persisted.active !== false) {
        // Restore room from DB
        console.log(`Teacher reconnecting — restoring room ${roomCode}`);
        let canvasState = null;
        try {
          const snap = await Snapshot.findOne({ sessionCode: roomCode }).lean();
          canvasState = snap ? snap.dataURL : null;
        } catch {}

        rooms[roomCode] = {
          code:        roomCode,
          title:       persisted.title,
          teacher:     { id: socket.id, name, email },
          members:     [{ id: socket.id, name, email, role: "teacher", muted: false }],
          canvasState,
          chats:       [],
          active:      true,
          classLocked: false,
          mutedIds:    new Set(),
          tempBans:    new Map(),
        };

        socket.join(roomCode);
        socket.emit("session-joined", {
          code:        roomCode,
          room:        rooms[roomCode],
          canvasState,
          chats:       [],
          role:        "teacher",
        });
        return;
      }

      // Ended session or student → read-only replay with last snapshot
      let snapshots = [];
      try {
        const snap = await Snapshot.findOne({ sessionCode: roomCode }).lean();
        if (snap) snapshots = [{ timestamp: snap.timestamp, dataURL: snap.dataURL }];
      } catch {}

      socket.emit("session-replay", {
        session:  { ...persisted, snapshots },
        readOnly: true,
      });
      return;
    }

    // ── Active room ────────────────────────────────────────────────────────────
    const isTeacher = email && email.toLowerCase() === TEACHER_EMAIL;
    const role      = isTeacher ? "teacher" : "student";

    if (!isTeacher) {
      // Permanent ban check (from DB)
      const permBans = (persisted?.permBans || []).map(e => e.toLowerCase());
      if (permBans.includes((email || "").toLowerCase())) {
        socket.emit("error-msg", { msg: "You have been permanently banned from this session." });
        return;
      }
      // Temp ban check (in-memory)
      const tempBan = room.tempBans && room.tempBans.get((email || "").toLowerCase());
      if (tempBan && Date.now() < tempBan) {
        const mins = Math.ceil((tempBan - Date.now()) / 60000);
        socket.emit("error-msg", { msg: `You are temporarily banned. Try again in ${mins} minute(s).` });
        return;
      }
    }

    if (!room.mutedIds) room.mutedIds = new Set();
    if (!room.tempBans) room.tempBans = new Map();

    const member = { id: socket.id, name, email, role, muted: false };
    room.members.push(member);

    // Track participant in DB (async, fire-and-forget)
    if (persisted) {
      const alreadyIn = (persisted.participants || []).some(p => p.email === email);
      if (!alreadyIn) {
        Session.updateOne({ code: roomCode }, { $addToSet: { participants: { name, email, role } } })
          .catch(e => console.error("participant update error:", e.message));
      }
    }

    socket.join(roomCode);
    socket.emit("session-joined", {
      code:       roomCode,
      room:       { ...room, members: room.members },
      canvasState: room.canvasState,
      chats:      room.chats,
      role,
    });
    socket.to(roomCode).emit("member-joined", { member, members: room.members });
    console.log(`${name} joined session ${roomCode} as ${role}`);
  });

  // ── Canvas drawing ─────────────────────────────────────────────────────────
  socket.on("canvas-draw", ({ code, dataURL }) => {
    const room = rooms[code];
    if (!room) return;
    room.canvasState = dataURL;
    socket.to(code).emit("canvas-update", { dataURL, senderId: socket.id });
  });

  socket.on("canvas-update", ({ code, dataURL }) => {
    const room = rooms[code];
    if (!room) return;
    room.canvasState = dataURL;
    socket.to(code).emit("canvas-update", { dataURL, senderId: socket.id });
  });

  socket.on("draw-stroke", ({ code, x0, y0, x1, y1, color, stroke, tool }) => {
    socket.to(code).emit("draw-stroke", { x0, y0, x1, y1, color, stroke, tool });
  });

  socket.on("draw-shape", ({ code, tool, start, end, color, stroke, isPreview }) => {
    socket.to(code).emit("draw-shape", { tool, start, end, color, stroke, isPreview, senderId: socket.id });
  });

  // ── Laser Pointer ──────────────────────────────────────────────────────────
  socket.on("laser-move", ({ code, x, y, color }) => {
    socket.to(code).emit("laser-move", { senderId: socket.id, x, y, color });
  });
  socket.on("laser-stop", ({ code }) => {
    socket.to(code).emit("laser-stop", { senderId: socket.id });
  });

  // ── Drawing presence (who is writing) ─────────────────────────────────────
  socket.on("drawing-cursor", ({ code, name, x, y }) => {
    socket.to(code).emit("drawing-cursor", { senderId: socket.id, name, x, y });
  });
  socket.on("drawing-stop", ({ code }) => {
    socket.to(code).emit("drawing-stop", { senderId: socket.id });
  });


  // ── Save snapshot (on demand — "Save Snapshot" button) ────────────────────
  // Replaces old snapshot: keeps storage at 1 per session
  socket.on("save-snapshot", async ({ code, dataURL }) => {
    try {
      const room = rooms[code];
      if (room) {
        room.canvasState = dataURL;
      }
      await saveSnapshot(code, dataURL, false);
      socket.emit("snapshot-saved", { timestamp: new Date().toISOString() });
      console.log(`Snapshot saved for ${code}`);
    } catch (e) {
      console.error("save-snapshot error:", e.message);
    }
  });

  // ── Chat ──────────────────────────────────────────────────────────────────
  socket.on("session-chat", ({ code, message, sender, role }) => {
    const room = rooms[code];
    if (!room) return;
    const chat = { sender, message, role, timestamp: new Date().toISOString() };
    room.chats.push(chat);
    // Keep last 200 chats in memory
    if (room.chats.length > 200) room.chats.shift();
    io.to(code).emit("chat-message", chat);
  });

  // ── Clear canvas (teacher only) ────────────────────────────────────────────
  socket.on("clear-canvas", ({ code }) => {
    const room   = rooms[code];
    if (!room) return;
    const member = room.members.find(m => m.id === socket.id);
    if (!member || member.role !== "teacher") return;
    room.canvasState = null;
    io.to(code).emit("canvas-cleared");
  });

  // ── End session (teacher only) ─────────────────────────────────────────────
  socket.on("end-session", async ({ code, finalDataURL }) => {
    const room = rooms[code];
    if (!room) return;
    const member = room.members.find(m => m.id === socket.id);
    if (!member || member.role !== "teacher") return;

    try {
      // Save final snapshot (replaces any previous)
      if (finalDataURL) await saveSnapshot(code, finalDataURL, true);
      // Mark session ended
      await Session.updateOne(
        { code },
        { active: false, endedAt: new Date() }
      );
    } catch (e) {
      console.error("end-session DB error:", e.message);
    }

    io.to(code).emit("session-ended", { code });
    delete rooms[code];
    console.log(`Session ${code} ended`);
  });

  // ── Lock All Students ──────────────────────────────────────────────────────
  socket.on("lock-class", ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const me = room.members.find(m => m.id === socket.id);
    if (!me || me.role !== "teacher") return;

    room.classLocked = true;
    room.members.forEach(m => {
      if (m.role !== "teacher") {
        m.muted = true;
        room.mutedIds.add(m.id);
        io.to(m.id).emit("you-were-muted", {});
      }
    });
    io.to(code).emit("class-locked", { members: room.members });
    console.log(`Class ${code} locked`);
  });

  // ── Unlock All Students ────────────────────────────────────────────────────
  socket.on("unlock-class", ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const me = room.members.find(m => m.id === socket.id);
    if (!me || me.role !== "teacher") return;

    room.classLocked = false;
    room.mutedIds.clear();
    room.members.forEach(m => {
      if (m.role !== "teacher") {
        m.muted = false;
        io.to(m.id).emit("you-were-unmuted", {});
      }
    });
    io.to(code).emit("class-unlocked", { members: room.members });
    console.log(`Class ${code} unlocked`);
  });

  // ── Mute / Unmute a student ────────────────────────────────────────────────
  socket.on("mute-student", ({ code, targetId, muted }) => {
    const room = rooms[code];
    if (!room) return;
    const me     = room.members.find(m => m.id === socket.id);
    if (!me || me.role !== "teacher") return;
    const target = room.members.find(m => m.id === targetId);
    if (!target || target.role === "teacher") return;

    target.muted = muted;
    if (muted) room.mutedIds.add(targetId);
    else       room.mutedIds.delete(targetId);

    io.to(targetId).emit(muted ? "you-were-muted" : "you-were-unmuted", {});
    io.to(code).emit("members-updated", { members: room.members });
    console.log(`${target.name} ${muted ? "muted" : "unmuted"} in ${code}`);
  });

  // ── Temp ban ───────────────────────────────────────────────────────────────
  socket.on("temp-ban-student", ({ code, targetId, minutes }) => {
    const room = rooms[code];
    if (!room) return;
    const me     = room.members.find(m => m.id === socket.id);
    if (!me || me.role !== "teacher") return;
    const target = room.members.find(m => m.id === targetId);
    if (!target || target.role === "teacher") return;

    const expiry = Date.now() + minutes * 60 * 1000;
    room.tempBans.set((target.email || "").toLowerCase(), expiry);

    io.to(targetId).emit("you-were-banned", { type: "temp", minutes });
    room.members = room.members.filter(m => m.id !== targetId);
    io.to(code).emit("members-updated", { members: room.members });
    setTimeout(() => {
      if (room.tempBans) room.tempBans.delete((target.email || "").toLowerCase());
    }, minutes * 60 * 1000);
    console.log(`${target.name} temp-banned ${minutes} min in ${code}`);
  });

  // ── Permanent ban ─────────────────────────────────────────────────────────
  socket.on("perm-ban-student", async ({ code, targetId }) => {
    const room = rooms[code];
    if (!room) return;
    const me     = room.members.find(m => m.id === socket.id);
    if (!me || me.role !== "teacher") return;
    const target = room.members.find(m => m.id === targetId);
    if (!target || target.role === "teacher") return;

    const lEmail = (target.email || "").toLowerCase();
    try {
      await Session.updateOne({ code }, { $addToSet: { permBans: lEmail } });
    } catch (e) {
      console.error("perm-ban DB error:", e.message);
    }

    io.to(targetId).emit("you-were-banned", { type: "perm" });
    room.members = room.members.filter(m => m.id !== targetId);
    io.to(code).emit("members-updated", { members: room.members });
    console.log(`${target.name} permanently banned from ${code}`);
  });

  // ── Kick ──────────────────────────────────────────────────────────────────
  socket.on("kick-member", ({ code, targetId }) => {
    const room = rooms[code];
    if (!room) return;
    const me   = room.members.find(m => m.id === socket.id);
    if (!me || me.role !== "teacher") return;
    io.to(targetId).emit("you-were-removed", {});
    room.members = room.members.filter(m => m.id !== targetId);
    io.to(code).emit("members-updated", { members: room.members });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log("disconnected:", socket.id);
    for (const [code, room] of Object.entries(rooms)) {
      const idx = room.members.findIndex(m => m.id === socket.id);
      if (idx > -1) {
        const [left] = room.members.splice(idx, 1);
        io.to(code).emit("member-left", { member: left, members: room.members });
        if (left.role === "teacher") io.to(code).emit("teacher-disconnected", {});
      }
    }
  });
});

// ─── START ───────────────────────────────────────────────────────────────────
// Start the server immediately so it passes Railway health checks, then connect to DB in the background
server.listen(PORT, () => {
  console.log(`ClassBoard server on port ${PORT}`);
  connectDB().catch(err => {
    console.error("MongoDB connection failed:", err.message);
  });
});
