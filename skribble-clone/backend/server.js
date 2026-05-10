const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config({ path: "../.env" });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  cors: { origin: "*" },
  connectionStateRecovery: {},
});

app.use(cors());
app.use(express.json());

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const TEACHER_EMAIL = (process.env.TEACHER_EMAIL || "itsvikash143@gmail").toLowerCase();
const SESSIONS_FILE = path.join(__dirname, "sessions.json");
const FOLDERS_FILE = path.join(__dirname, "folders.json");
const PORT = process.env.PORT || 3001;

// ─── PERSISTENCE (file-based) ─────────────────────────────────────────────────
/**
 * sessions.json structure:
 * {
 *   "CLASS_CODE": {
 *     code: "CLASS_CODE",
 *     title: "Session Title",
 *     createdBy: "teacher name",
 *     createdAt: ISO string,
 *     endedAt: ISO string | null,
 *     active: boolean,
 *     participants: [{ name, email, role }],
 *     snapshots: [{ timestamp, dataURL }],   // periodic canvas saves
 *     chats: [{ sender, message, timestamp }]
 *   }
 * }
 */
function loadSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveSessions(sessions) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function loadFolders() {
  if (!fs.existsSync(FOLDERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FOLDERS_FILE, "utf8")); } catch { return []; }
}

function saveFolders(folders) {
  fs.writeFileSync(FOLDERS_FILE, JSON.stringify(folders, null, 2));
}

let persistedSessions = loadSessions();
let persistedFolders = loadFolders();

// ─── IN-MEMORY ROOM STATE ──────────────────────────────────────────────────────
// rooms[code] = { code, title, teacher, members:[{id,name,email,role}], canvasState, chats[] }
const rooms = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ─── REST API ─────────────────────────────────────────────────────────────────
// Get all past sessions (for session history)
app.get("/api/sessions", (req, res) => {
  const list = Object.values(persistedSessions).map((s) => ({
    code: s.code,
    title: s.title,
    createdBy: s.createdBy,
    createdAt: s.createdAt,
    endedAt: s.endedAt,
    active: s.active,
    participantCount: (s.participants || []).length,
    snapshotCount: (s.snapshots || []).length,
    folder: s.folder || "",
  }));
  res.json(list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// Update session folder
app.patch("/api/sessions/:code/folder", (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = persistedSessions[code];
  if (!s) return res.status(404).json({ error: "Session not found" });
  s.folder = req.body.folder || "";
  saveSessions(persistedSessions);
  res.json({ success: true, folder: s.folder });
});

// Folders endpoints
app.get("/api/folders", (req, res) => {
  res.json(persistedFolders);
});

app.post("/api/folders", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });
  const newFolder = { id: Date.now().toString(), name };
  persistedFolders.push(newFolder);
  saveFolders(persistedFolders);
  res.json(newFolder);
});

app.patch("/api/folders/:id", (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const folder = persistedFolders.find(f => f.id === id);
  if (!folder) return res.status(404).json({ error: "Folder not found" });
  
  const oldName = folder.name;
  folder.name = name;
  
  let updated = false;
  Object.values(persistedSessions).forEach(s => {
    if (s.folder === oldName) {
      s.folder = name;
      updated = true;
    }
  });
  if (updated) saveSessions(persistedSessions);
  
  saveFolders(persistedFolders);
  res.json(folder);
});

app.delete("/api/folders/:id", (req, res) => {
  const { id } = req.params;
  const folder = persistedFolders.find(f => f.id === id);
  if (!folder) return res.status(404).json({ error: "Folder not found" });
  
  const oldName = folder.name;
  persistedFolders = persistedFolders.filter(f => f.id !== id);
  
  let updated = false;
  Object.values(persistedSessions).forEach(s => {
    if (s.folder === oldName) {
      s.folder = "";
      updated = true;
    }
  });
  if (updated) saveSessions(persistedSessions);
  
  saveFolders(persistedFolders);
  res.json({ success: true });
});

// Get a specific session (with last snapshot for whiteboard replay)
app.get("/api/sessions/:code", (req, res) => {
  const s = persistedSessions[req.params.code.toUpperCase()];
  if (!s) return res.status(404).json({ error: "Session not found" });
  res.json(s);
});

// Deployment
const __dirname1 = path.resolve();
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname1, "./frontend/build")));
  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname1, "frontend", "build", "index.html"));
  });
} else {
  app.get("/", (req, res) => res.send("ClassBoard API running"));
}

server.listen(PORT, () => console.log(`ClassBoard server on port ${PORT}`));

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  // ── Create a new class session (teacher only) ───────────────────────────
  socket.on("create-session", ({ name, email, title }) => {
    const isTeacher = email && email.toLowerCase() === TEACHER_EMAIL;
    if (!isTeacher) {
      socket.emit("error-msg", { msg: "Only the teacher can create a session." });
      return;
    }

    const code = generateCode();
    rooms[code] = {
      code,
      title: title || "Untitled Class",
      teacher: { id: socket.id, name, email },
      members: [{ id: socket.id, name, email, role: "teacher" }],
      canvasState: null, // latest canvas dataURL
      chats: [],
      active: true,
    };

    // Persist
    persistedSessions[code] = {
      code,
      title: title || "Untitled Class",
      createdBy: name,
      teacherEmail: email,
      createdAt: new Date().toISOString(),
      endedAt: null,
      active: true,
      participants: [{ name, email, role: "teacher" }],
      snapshots: [],
      chats: [],
    };
    saveSessions(persistedSessions);

    socket.join(code);
    socket.emit("session-created", { code, room: rooms[code] });
    console.log(`Session created: ${code} by ${name}`);
  });

  // ── Join an existing session ────────────────────────────────────────────
  socket.on("join-session", ({ name, email, code }) => {
    const roomCode = code.toUpperCase();
    const room = rooms[roomCode];
    const persisted = persistedSessions[roomCode];

    if (!room && !persisted) {
      socket.emit("error-msg", { msg: `No session found with code "${roomCode}".` });
      return;
    }

    // If session ended (persisted only, not active), send read-only replay
    if (persisted && !room) {
      socket.emit("session-replay", {
        session: persisted,
        readOnly: true,
      });
      return;
    }

    // Verify participant is allowed (teacher or any registered member)
    const isTeacher = email && email.toLowerCase() === TEACHER_EMAIL;
    const role = isTeacher ? "teacher" : "student";

    const member = { id: socket.id, name, email, role };
    room.members.push(member);

    // Track in persisted
    if (persisted) {
      const already = persisted.participants.find((p) => p.email === email);
      if (!already) {
        persisted.participants.push({ name, email, role });
        saveSessions(persistedSessions);
      }
    }

    socket.join(roomCode);

    // Send room info + current canvas state to new joiner
    socket.emit("session-joined", {
      code: roomCode,
      room: {
        ...room,
        members: room.members,
      },
      canvasState: room.canvasState,
      chats: room.chats,
      role,
    });

    // Notify everyone else
    socket.to(roomCode).emit("member-joined", { member, members: room.members });
    console.log(`${name} joined session ${roomCode} as ${role}`);
  });

  // ── Canvas drawing (broadcast to room) ─────────────────────────────────
  socket.on("canvas-draw", ({ code, dataURL }) => {
    const room = rooms[code];
    if (!room) return;
    room.canvasState = dataURL; // keep latest
    socket.to(code).emit("canvas-update", { dataURL, senderId: socket.id });
  });

  socket.on("draw-stroke", ({ code, x0, y0, x1, y1, color, stroke, tool }) => {
    socket.to(code).emit("draw-stroke", { x0, y0, x1, y1, color, stroke, tool });
  });

  // ── Laser Pointer ───────────────────────────────────────────────────────
  socket.on("laser-move", ({ code, x, y, color }) => {
    socket.to(code).emit("laser-move", { senderId: socket.id, x, y, color });
  });

  socket.on("laser-stop", ({ code }) => {
    socket.to(code).emit("laser-stop", { senderId: socket.id });
  });

  // ── Save canvas snapshot (periodically called by teacher or on demand) ──
  socket.on("save-snapshot", ({ code, dataURL }) => {
    const persisted = persistedSessions[code];
    if (!persisted) return;
    const snap = { timestamp: new Date().toISOString(), dataURL };
    persisted.snapshots.push(snap);
    // Keep only last 20 snapshots to avoid huge files
    if (persisted.snapshots.length > 20) persisted.snapshots.shift();
    saveSessions(persistedSessions);
    socket.emit("snapshot-saved", { timestamp: snap.timestamp });
  });

  // ── Chat message in session ─────────────────────────────────────────────
  socket.on("session-chat", ({ code, message, sender, role }) => {
    const room = rooms[code];
    if (!room) return;
    const chat = { sender, message, role, timestamp: new Date().toISOString() };
    room.chats.push(chat);
    const persisted = persistedSessions[code];
    if (persisted) {
      persisted.chats.push(chat);
      saveSessions(persistedSessions);
    }
    io.to(code).emit("chat-message", chat);
  });

  // ── Canvas clear (teacher only) ─────────────────────────────────────────
  socket.on("clear-canvas", ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const member = room.members.find((m) => m.id === socket.id);
    if (!member || member.role !== "teacher") return;
    room.canvasState = null;
    io.to(code).emit("canvas-cleared");
  });

  // ── End session (teacher only) ──────────────────────────────────────────
  socket.on("end-session", ({ code, finalDataURL }) => {
    const room = rooms[code];
    if (!room) return;
    const member = room.members.find((m) => m.id === socket.id);
    if (!member || member.role !== "teacher") return;

    // Save final snapshot
    const persisted = persistedSessions[code];
    if (persisted) {
      if (finalDataURL) {
        persisted.snapshots.push({ timestamp: new Date().toISOString(), dataURL: finalDataURL, isFinal: true });
      }
      persisted.endedAt = new Date().toISOString();
      persisted.active = false;
      saveSessions(persistedSessions);
    }

    io.to(code).emit("session-ended", { code });
    delete rooms[code];
    console.log(`Session ${code} ended`);
  });

  // ── Kick a participant (teacher only) ────────────────────────────────────
  socket.on("kick-member", ({ code, targetId }) => {
    const room = rooms[code];
    if (!room) return;
    const me = room.members.find((m) => m.id === socket.id);
    if (!me || me.role !== "teacher") return;
    io.to(targetId).emit("you-were-removed", {});
    room.members = room.members.filter((m) => m.id !== targetId);
    io.to(code).emit("members-updated", { members: room.members });
  });

  // ── Disconnect ──────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log("disconnected:", socket.id);
    // Remove member from all rooms they were in
    for (const [code, room] of Object.entries(rooms)) {
      const idx = room.members.findIndex((m) => m.id === socket.id);
      if (idx > -1) {
        const [left] = room.members.splice(idx, 1);
        io.to(code).emit("member-left", { member: left, members: room.members });
        // If teacher disconnects, notify room
        if (left.role === "teacher") {
          io.to(code).emit("teacher-disconnected", {});
        }
      }
    }
  });
});
