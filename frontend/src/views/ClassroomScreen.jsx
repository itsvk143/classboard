// ClassroomScreen.jsx — Main real-time collaborative whiteboard
import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  MousePointer2, Move, PenTool, Highlighter, Eraser, Circle, Square,
  Triangle, Hexagon, Minus, Zap, Trash2, FileDown, Save, LogOut,
  ChevronDown, ChevronUp, Menu, Copy, Maximize, ArrowLeft,
  FilePlus2, ImagePlus, Wand2, Hand
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { SOCKET_ENDPOINT } from "../config";
import { jsPDF } from "jspdf";
import "../App.css";

const ENDPOINT = SOCKET_ENDPOINT;
const COLORS = [
  "#000000", "#ffffff", "#ef4444", "#3b82f6", "#22c55e", "#ec4899",
];
const TOOLS = { SELECT: "select", LASSO: "lasso", PAN: "pan", PEN: "pen", ERASER: "eraser", OBJ_ERASER: "obj_eraser", HIGHLIGHTER: "highlighter", LASER: "laser", LINE: "line", TRIANGLE: "triangle", CIRCLE: "circle", RECTANGLE: "rectangle", SQUARE: "square", HEXAGON: "hexagon" };

const getWhiteBackgroundDataURL = (canvas, quality = 0.95, selection = null) => {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const ctx = tempCanvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  ctx.drawImage(canvas, 0, 0);

  if (selection && selection.imgData) {
    const selCanvas = document.createElement("canvas");
    selCanvas.width = selection.w;
    selCanvas.height = selection.h;
    selCanvas.getContext("2d").putImageData(selection.imgData, 0, 0);

    ctx.save();
    const cx = selection.x + selection.w / 2;
    const cy = selection.y + selection.h / 2;
    ctx.translate(cx, cy);
    if (selection.rotation) ctx.rotate(selection.rotation);
    const s = selection.scale || 1;
    ctx.scale(s, s);
    ctx.drawImage(selCanvas, -selection.w / 2, -selection.h / 2);
    ctx.restore();
  }

  return tempCanvas.toDataURL("image/jpeg", quality);
};

// ── Auto-save every 60 seconds ─────────────────────────────────────────────
const AUTO_SAVE_INTERVAL = 60 * 1000;

export default function ClassroomScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state || {};

  // ── Session recovery: restore from localStorage if page was refreshed ────────
  // On a browser refresh, React Router loses location.state. We persist the
  // minimal session info (name, code, role) in localStorage so the user
  // automatically rejoins instead of getting a brand-new session code.
  const _saved = (() => {
    try { return JSON.parse(localStorage.getItem('classboard_session') || 'null'); }
    catch { return null; }
  })();

  const action       = state.action       || (_saved ? 'join'        : null);
  const name         = state.name         || _saved?.name         || '';
  const email        = state.email        || _saved?.email        || '';
  const sessionTitle = state.sessionTitle || _saved?.sessionTitle || 'My Class';
  const joinCode     = (state.action === 'create') ? '' : (state.code || _saved?.code || '');
  const isTeacher    = state.isTeacher    ?? (_saved?.role === 'teacher');

  const sessionCodeRef = useRef(joinCode || '');

  // Socket & session
  const [socket, setSocket] = useState(null);
  const [sessionCode, setSessionCode] = useState(joinCode || "");
  const [sessionInfo, setSessionInfo] = useState(null);
  const [members, setMembers] = useState([]);
  const [role, setRole] = useState(isTeacher ? "teacher" : "student");
  const [sessionEnded, setSessionEnded] = useState(false);

  useEffect(() => {
    sessionCodeRef.current = sessionCode;
  }, [sessionCode]);

  // Chat
  const [chats, setChats] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef(null);

  // Canvas
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const [tool, setTool] = useState(TOOLS.PEN);
  const [color, setColor] = useState("#000000");
  const [stroke, setStroke] = useState(4);
  const isPainting = useRef(false);
  const lastPos = useRef(null);
  const lastMid = useRef(null); // tracks last midpoint for continuous smooth curves
  const startPos = useRef(null);
  const snapshotRef = useRef(null); // for straight line preview
  const [lasers,          setLasers]          = useState({});
  const [remoteDrawers,   setRemoteDrawers]   = useState({}); // { socketId: { name, x, y } }
  const drawCursorThrottle = useRef(0); // ms timestamp of last drawing-cursor emit
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLeftMenuOpen, setIsLeftMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isSidebarOpenRef = useRef(isSidebarOpen);
  const [zoom, setZoom] = useState(1.0); // 1.0 = 100%
  const [showMoreShapes, setShowMoreShapes] = useState(false);
  const [shapeMenuCoords, setShapeMenuCoords] = useState({ top: 0, left: 0 });
  // Palm rejection: when true only Apple Pencil (pointerType='pen') can draw
  const [pencilOnly, setPencilOnly] = useState(false);
  // true when pencilOnly was auto-activated by stylus detection (vs manual toggle)
  const stylusDetected = useRef(false);

  // Selection state
  const [selection, setSelection] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const isDraggingSelection = useRef(false);
  const isRotatingSelection = useRef(false);
  const isResizingSelection = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const lassoPath = useRef([]);
  const selCanvasRef = useRef(null);
  const selectionDivRef = useRef(null);
  const liveSelectionRef = useRef(null);
  const [remotePreviews, setRemotePreviews] = useState({}); // { senderId: { tool, start, end, color, stroke } }
  const canvasWrapperRef = useRef(null);
  const isPanningCanvas = useRef(false);
  const panStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  useEffect(() => {
    liveSelectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    if (selCanvasRef.current && selection?.imgData) {
      selCanvasRef.current.getContext("2d").putImageData(selection.imgData, 0, 0);
    }
  }, [selection?.imgData]);

  useEffect(() => {
    isSidebarOpenRef.current = isSidebarOpen;
    if (isSidebarOpen) setUnreadCount(0);
  }, [isSidebarOpen]);

  // UI
  const [toast, setToast] = useState("");
  const [kicked, setKicked] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [classLocked, setClassLocked] = useState(false);
  const [banned, setBanned] = useState(null);
  const [activeStudentMenu, setActiveStudentMenu] = useState(null);
  const [snapshotSaved, setSnapshotSaved] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  // ── Init canvas ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctxRef.current = ctx;
  }, []);

  // Update ctx settings when tool/color/stroke changes
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.lineWidth = tool === TOOLS.ERASER ? stroke * 4 : stroke;
    ctx.strokeStyle = tool === TOOLS.ERASER ? "#ffffff" : color;
    ctx.globalAlpha = tool === TOOLS.HIGHLIGHTER ? 0.3 : 1.0;
  }, [tool, color, stroke]);

  // ── Socket setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!name || !action) { navigate("/"); return; }

    const sock = io(ENDPOINT);
    setSocket(sock);

    sock.on("connect", () => {
      if (action === "create" && !sessionCodeRef.current) {
        sock.emit("create-session", { name, email, title: sessionTitle });
      } else {
        sock.emit("join-session", { name, email, code: sessionCodeRef.current || joinCode });
      }
    });

    sock.on("session-created", ({ code, room }) => {
      setSessionCode(code);
      setSessionInfo(room);
      setMembers(room.members || []);
      setRole("teacher");
      // Persist so refresh rejoins the same session
      localStorage.setItem('classboard_session', JSON.stringify({ name, email, code, role: 'teacher', sessionTitle }));
      showToast(`Session created! Code: ${code}`);
    });

    sock.on("session-joined", ({ code, room, canvasState, chats: prevChats, role: r }) => {
      setSessionCode(code);
      setSessionInfo(room);
      setMembers(room.members || []);
      setRole(r);
      setChats(prevChats || []);
      if (canvasState) loadCanvasFromDataURL(canvasState);
      // Persist so refresh rejoins the same session
      localStorage.setItem('classboard_session', JSON.stringify({ name, email, code, role: r, sessionTitle }));
      showToast(`Joined session ${code}`);
    });

    sock.on("session-replay", ({ session }) => {
      // Redirected to read-only replay
      navigate(`/replay/${session.code}`, { state: { session } });
    });

    sock.on("member-joined", ({ member, members: m }) => {
      setMembers(m);
      addSystemChat(`${member.name} joined the class`);
    });

    sock.on("member-left", ({ member, members: m }) => {
      setMembers(m);
      addSystemChat(`${member.name} left the class`);
    });

    sock.on("members-updated", ({ members: m }) => setMembers(m));

    sock.on("canvas-update", ({ dataURL }) => loadCanvasFromDataURL(dataURL));

    sock.on("draw-stroke", ({ x0, y0, x1, y1, color: strokeColor, stroke: strokeWidth, tool: toolUsed }) => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.globalAlpha = toolUsed === TOOLS.HIGHLIGHTER ? 0.3 : 1.0;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
    });

    sock.on("draw-shape", ({ tool: shapeTool, start, end, color: shapeColor, stroke: shapeWidth, isPreview, senderId }) => {
      if (isPreview) {
        setRemotePreviews(prev => ({ ...prev, [senderId]: { tool: shapeTool, start, end, color: shapeColor, stroke: shapeWidth } }));
      } else {
        setRemotePreviews(prev => {
          const next = { ...prev };
          delete next[senderId];
          return next;
        });
        const ctx = ctxRef.current;
        if (!ctx) return;
        drawShape(ctx, shapeTool, start, end, shapeColor, shapeWidth);
      }
    });

    sock.on("laser-move", ({ senderId, x, y, color }) => {
      setLasers(prev => ({ ...prev, [senderId]: { x, y, color } }));
    });

    sock.on("laser-stop", ({ senderId }) => {
      setLasers(prev => {
        const next = { ...prev };
        delete next[senderId];
        return next;
      });
    });

    sock.on("canvas-cleared", () => {
      const ctx = ctxRef.current;
      if (ctx && canvasRef.current) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      addSystemChat("Canvas cleared by teacher");
    });

    sock.on("chat-message", (msg) => {
      setChats((prev) => [...prev, msg]);
      if (!isSidebarOpenRef.current) {
        setUnreadCount((prev) => prev + 1);
      }
    });

    sock.on("session-ended", () => {
      setSessionEnded(true);
    });

    sock.on("teacher-disconnected", () => {
      addSystemChat("Teacher disconnected — class paused");
    });

    sock.on("you-were-removed", () => setKicked(true));
    sock.on("you-were-muted",   () => { setIsMuted(true);  showToast("🔇 You have been muted by the teacher."); });
    sock.on("you-were-unmuted", () => { setIsMuted(false); showToast("🔊 You can draw again."); });
    sock.on("you-were-banned",  ({ type, minutes }) => setBanned({ type, minutes }));
    sock.on("class-locked",   ({ members: m }) => { setMembers(m); setClassLocked(true);  showToast("🔒 Teacher locked the board."); });
    sock.on("class-unlocked", ({ members: m }) => { setMembers(m); setClassLocked(false); showToast("🔓 Board unlocked — you can draw."); });

    sock.on("snapshot-saved", ({ timestamp }) => {
      setSnapshotSaved(new Date(timestamp).toLocaleTimeString());
      setTimeout(() => setSnapshotSaved(null), 3000);
    });

    sock.on("error-msg", ({ msg }) => showToast("⚠️ " + msg));

    // ── Drawing presence ───────────────────────────────────────────────────
    sock.on("drawing-cursor", ({ senderId, name, x, y }) => {
      setRemoteDrawers(prev => ({ ...prev, [senderId]: { name, x, y } }));
    });
    sock.on("drawing-stop", ({ senderId }) => {
      setRemoteDrawers(prev => {
        const next = { ...prev };
        delete next[senderId];
        return next;
      });
    });

    return () => sock.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-scroll chat ─────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats]);

  // ── Auto-save canvas snapshot ────────────────────────────────────────────
  useEffect(() => {
    if (!socket || role !== "teacher") return;
    const interval = setInterval(() => {
      if (canvasRef.current) {
        const dataURL = getWhiteBackgroundDataURL(canvasRef.current, 0.7, liveSelectionRef.current);
        socket.emit("save-snapshot", { code: sessionCode, dataURL });
      }
    }, AUTO_SAVE_INTERVAL);
    return () => clearInterval(interval);
  }, [socket, sessionCode, role]);

  // ── Canvas helpers ────────────────────────────────────────────────────────
  const loadCanvasFromDataURL = (dataURL) => {
    if (!canvasRef.current || !ctxRef.current) return;
    const img = new Image();
    img.onload = () => {
      ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      ctxRef.current.drawImage(img, 0, 0);
    };
    img.src = dataURL;
  };

  // Use Pointer Events clientX/clientY directly (no need for e.touches with PointerEvent API)
  const getPos = (e) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top)  / zoom,
    };
  };

  const emitCanvas = useCallback(() => {
    if (!socket || !canvasRef.current) return;
    const dataURL = getWhiteBackgroundDataURL(canvasRef.current, 0.6, liveSelectionRef.current);
    socket.emit("canvas-update", { code: sessionCode, dataURL });
  }, [socket, sessionCode]);

  const emitStroke = useCallback((x0, y0, x1, y1, toolUsed) => {
    if (!socket) return;
    socket.emit("draw-stroke", {
      code: sessionCode,
      x0, y0, x1, y1,
      color: toolUsed === TOOLS.ERASER ? "#ffffff" : color,
      stroke: toolUsed === TOOLS.ERASER ? stroke * 4 : stroke,
      tool: toolUsed
    });
  }, [socket, sessionCode, color, stroke]);

  const applySelectionToCanvas = useCallback((sel) => {
    if (!sel || !sel.imgData) return;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = sel.w;
    tempCanvas.height = sel.h;
    tempCanvas.getContext("2d").putImageData(sel.imgData, 0, 0);

    ctxRef.current.save();
    const cx = sel.x + sel.w / 2;
    const cy = sel.y + sel.h / 2;
    ctxRef.current.translate(cx, cy);
    if (sel.rotation) ctxRef.current.rotate(sel.rotation);
    const s = sel.scale || 1;
    ctxRef.current.scale(s, s);
    ctxRef.current.drawImage(tempCanvas, -sel.w / 2, -sel.h / 2);
    ctxRef.current.restore();
  }, []);

  const cutSelectionFromCanvas = useCallback((sel) => {
    ctxRef.current.fillStyle = "#ffffff";
    if (sel.type === TOOLS.LASSO && sel.path) {
      ctxRef.current.beginPath();
      sel.path.forEach((p, i) => {
        if (i === 0) ctxRef.current.moveTo(p.x, p.y);
        else ctxRef.current.lineTo(p.x, p.y);
      });
      ctxRef.current.closePath();
      ctxRef.current.fill();
    } else {
      ctxRef.current.fillRect(sel.x, sel.y, sel.w, sel.h);
    }
  }, []);

  const isSelectionTool = (t) => t === TOOLS.SELECT || t === TOOLS.LASSO;

  // Handle selection tool commit on tool change
  useEffect(() => {
    if (!isSelectionTool(tool) && selection) {
      if (ctxRef.current) {
        applySelectionToCanvas(selection);
        emitCanvas();
      }
      setSelection(null);
    }
  }, [tool, selection, emitCanvas, applySelectionToCanvas]);

  // Handle Copy/Paste/Delete shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "Backspace" || e.key === "Delete") {
        if (selection) {
          if (!selection.isCut) {
            cutSelectionFromCanvas(selection);
            emitCanvas();
          }
          setSelection(null);
        }
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "c" && selection) {
          setClipboard({ ...selection, isCut: false });
          showToast("Copied to clipboard!");
        }
        if (e.key === "v" && clipboard) {
          if (selection) {
            applySelectionToCanvas(selection);
            emitCanvas();
          }
          setSelection({ ...clipboard, x: clipboard.x + 20, y: clipboard.y + 20, isCut: true });
          setTool(clipboard.type || TOOLS.SELECT);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selection, clipboard, emitCanvas, applySelectionToCanvas, cutSelectionFromCanvas]);

  // ── Mouse/touch handlers ──────────────────────────────────────────────────
  const isShapeTool = (t) => [TOOLS.LINE, TOOLS.TRIANGLE, TOOLS.CIRCLE, TOOLS.RECTANGLE, TOOLS.SQUARE, TOOLS.HEXAGON].includes(t);

  const drawShape = (ctx, shapeTool, start, end, strokeColor, strokeWidth) => {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    const x = start.x;
    const y = start.y;
    const w = end.x - x;
    const h = end.y - y;

    if (shapeTool === TOOLS.LINE) {
      ctx.moveTo(x, y);
      ctx.lineTo(end.x, end.y);
    } else if (shapeTool === TOOLS.RECTANGLE) {
      ctx.rect(x, y, w, h);
    } else if (shapeTool === TOOLS.SQUARE) {
      const side = Math.max(Math.abs(w), Math.abs(h));
      ctx.rect(x, y, w < 0 ? -side : side, h < 0 ? -side : side);
    } else if (shapeTool === TOOLS.CIRCLE) {
      const radius = Math.sqrt(w * w + h * h);
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
    } else if (shapeTool === TOOLS.TRIANGLE) {
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
    } else if (shapeTool === TOOLS.HEXAGON) {
      const radius = Math.sqrt(w * w + h * h);
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - (Math.PI / 2);
        const hx = x + radius * Math.cos(angle);
        const hy = y + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
    }
    ctx.stroke();
  };

  // ── Object (Flood-fill) Eraser ───────────────────────────────────────────
  const floodFillErase = useCallback((px, py) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const imgData = ctx.getImageData(0, 0, W, H);
    const data = imgData.data;

    const ix = Math.round(px);
    const iy = Math.round(py);
    if (ix < 0 || ix >= W || iy < 0 || iy >= H) return;

    const idx = (iy * W + ix) * 4;
    const tr = data[idx], tg = data[idx + 1], tb = data[idx + 2];

    // If already white (or near-white), nothing to erase
    if (tr > 245 && tg > 245 && tb > 245) return;

    // Tolerance for color matching (handles anti-aliasing)
    const TOL = 60;
    const matches = (i) => {
      return Math.abs(data[i] - tr) <= TOL &&
             Math.abs(data[i + 1] - tg) <= TOL &&
             Math.abs(data[i + 2] - tb) <= TOL;
    };

    // Scanline stack flood fill for performance
    const stack = [[ix, iy]];
    const visited = new Uint8Array(W * H);
    visited[iy * W + ix] = 1;

    while (stack.length > 0) {
      const [cx, cy] = stack.pop();
      const ci = (cy * W + cx) * 4;
      // Erase to white
      data[ci] = 255; data[ci + 1] = 255; data[ci + 2] = 255; data[ci + 3] = 255;

      const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = ny * W + nx;
        if (visited[ni]) continue;
        visited[ni] = 1;
        const npi = ni * 4;
        if (matches(npi)) stack.push([nx, ny]);
      }
    }

    ctx.putImageData(imgData, 0, 0);
    emitCanvas();
  }, [emitCanvas]);

  const onDown = (e) => {
    if (e.button === 2) return; // ignore right-click

    if (tool === TOOLS.PAN) {
      isPanningCanvas.current = true;
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: canvasWrapperRef.current ? canvasWrapperRef.current.scrollLeft : 0,
        scrollTop: canvasWrapperRef.current ? canvasWrapperRef.current.scrollTop : 0
      };
      try { e.currentTarget?.setPointerCapture(e.pointerId); } catch {}
      return;
    }

    // ── Auto stylus detection ─────────────────────────────────────────────────
    // The first time Apple Pencil / any stylus touches the canvas, automatically
    // enable palm rejection so finger/palm touches are ignored from that point on.
    if (e.pointerType === 'pen' && !stylusDetected.current) {
      stylusDetected.current = true;
      setPencilOnly(true);
      showToast('✏️ Stylus detected — Palm Rejection enabled automatically');
    }

    // ── Palm rejection ────────────────────────────────────────────────────────
    // When pencilOnly mode is on, only Apple Pencil (pointerType='pen') can draw.
    // Finger/palm touches are silently ignored.
    if (pencilOnly && e.pointerType === 'touch') return;

    // If already painting with a different pointer, reject multi-touch draw
    if (isPainting.current && e.pointerType === 'touch') return;

    e.preventDefault();

    // Capture pointer so strokes don't break if pen briefly leaves canvas bounds
    try { e.currentTarget?.setPointerCapture(e.pointerId); } catch {}

    // Block all drawing when muted by teacher
    if (isMuted && role !== 'teacher') {
      showToast('🔇 You are muted — drawing is disabled.');
      return;
    }

    const pos = getPos(e);

    // Object Eraser: flood-fill on click
    if (tool === TOOLS.OBJ_ERASER) {
      floodFillErase(pos.x, pos.y);
      return;
    }

    if (isSelectionTool(tool)) {
      if (isRotatingSelection.current || isResizingSelection.current) return;

      let isHit = false;
      if (selection) {
        const cx = selection.x + selection.w / 2;
        const cy = selection.y + selection.h / 2;
        const dx = pos.x - cx;
        const dy = pos.y - cy;
        const rAngle = -(selection.rotation || 0);
        const rxOffset = dx * Math.cos(rAngle) - dy * Math.sin(rAngle);
        const ryOffset = dx * Math.sin(rAngle) + dy * Math.cos(rAngle);

        const s = selection.scale || 1;
        const scaledW = selection.w * s;
        const scaledH = selection.h * s;

        if (rxOffset >= -scaledW / 2 && rxOffset <= scaledW / 2 && ryOffset >= -scaledH / 2 && ryOffset <= scaledH / 2) {
          isHit = true;
        }
      }

      if (isHit) {
        isDraggingSelection.current = true;
        dragOffset.current = { x: pos.x - selection.x, y: pos.y - selection.y };
        if (!selection.isCut) {
          cutSelectionFromCanvas(selection);
          setSelection(prev => ({ ...prev, isCut: true }));
          emitCanvas();
        }
      } else {
        if (selection) {
          applySelectionToCanvas(selection);
          emitCanvas();
          setSelection(null);
        }
        isPainting.current = true;
        startPos.current = pos;
        lassoPath.current = [pos];
        snapshotRef.current = ctxRef.current.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    isPainting.current = true;
    lastPos.current = pos;
    startPos.current = pos;

    if (isShapeTool(tool)) {
      snapshotRef.current = ctxRef.current.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    } else {
      ctxRef.current.setLineDash([]);
      ctxRef.current.lineCap  = 'round';
      ctxRef.current.lineJoin = 'round';
      ctxRef.current.beginPath();
      ctxRef.current.moveTo(pos.x, pos.y);
      lastMid.current = pos; // initialise lastMid at stroke start
    }
  };

  // ── onMove: use getCoalescedEvents() to prevent missed strokes on fast writing ──
  // Without this, the browser may coalesce 5-10 intermediate points into one event,
  // causing letters to look broken or have missing segments on iPad.
  const onMove = (e) => {
    if (isPanningCanvas.current && panStart.current && canvasWrapperRef.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      canvasWrapperRef.current.scrollLeft = panStart.current.scrollLeft - dx;
      canvasWrapperRef.current.scrollTop = panStart.current.scrollTop - dy;
      return;
    }

    // Palm rejection: reject finger/palm in pencil-only mode
    if (pencilOnly && e.pointerType === 'touch') return;

    e.preventDefault();

    // Get ALL intermediate points the browser may have coalesced (critical for iPad)
    const events = (e.getCoalescedEvents && e.getCoalescedEvents().length > 0)
      ? e.getCoalescedEvents()
      : [e];

    for (const coalescedEvent of events) {
      processMoveEvent(coalescedEvent);
    }
  };

  const processMoveEvent = (e) => {
    const pos = getPos(e);

    if (isSelectionTool(tool)) {
      if (isResizingSelection.current && liveSelectionRef.current) {
        const sel = liveSelectionRef.current;
        const cx = sel.x + sel.w / 2;
        const cy = sel.y + sel.h / 2;
        const currentDist = Math.sqrt((pos.x - cx) ** 2 + (pos.y - cy) ** 2);
        const origDist = Math.sqrt((sel.w / 2) ** 2 + (sel.h / 2) ** 2);
        const newScale = Math.max(0.1, currentDist / origDist);
        sel.scale = newScale;
        if (selectionDivRef.current) {
          selectionDivRef.current.style.transform = `rotate(${sel.rotation || 0}rad) scale(${newScale})`;
        }
      } else if (isRotatingSelection.current && liveSelectionRef.current) {
        const sel = liveSelectionRef.current;
        const cx = sel.x + sel.w / 2;
        const cy = sel.y + sel.h / 2;
        const angle = Math.atan2(pos.y - cy, pos.x - cx) + Math.PI / 2;
        sel.rotation = angle;
        if (selectionDivRef.current) {
          selectionDivRef.current.style.transform = `rotate(${angle}rad) scale(${sel.scale || 1})`;
        }
      } else if (isDraggingSelection.current && liveSelectionRef.current) {
        const sel = liveSelectionRef.current;
        sel.x = pos.x - dragOffset.current.x;
        sel.y = pos.y - dragOffset.current.y;
        if (selectionDivRef.current) {
          selectionDivRef.current.style.left = `${sel.x}px`;
          selectionDivRef.current.style.top = `${sel.y}px`;
        }
      } else if (isPainting.current) {
        ctxRef.current.putImageData(snapshotRef.current, 0, 0);
        ctxRef.current.setLineDash([5, 5]);
        ctxRef.current.strokeStyle = "#3b82f6";
        ctxRef.current.lineWidth = 1;

        if (tool === TOOLS.SELECT) {
          ctxRef.current.strokeRect(startPos.current.x, startPos.current.y, pos.x - startPos.current.x, pos.y - startPos.current.y);
        } else if (tool === TOOLS.LASSO) {
          lassoPath.current.push(pos);
          ctxRef.current.beginPath();
          lassoPath.current.forEach((p, i) => {
            if (i === 0) ctxRef.current.moveTo(p.x, p.y);
            else ctxRef.current.lineTo(p.x, p.y);
          });
          ctxRef.current.stroke();
        }
        ctxRef.current.setLineDash([]);
      }
      return;
    }

    if (!isPainting.current) return;

    if (tool === TOOLS.LASER) {
      if (socket) socket.emit("laser-move", { code: sessionCode, x: pos.x, y: pos.y, color });
      lastPos.current = pos;
      return;
    }

    if (isShapeTool(tool)) {
      ctxRef.current.putImageData(snapshotRef.current, 0, 0);
      drawShape(ctxRef.current, tool, startPos.current, pos, color, stroke);
    } else if (tool === TOOLS.PEN || tool === TOOLS.HIGHLIGHTER) {
      ctxRef.current.setLineDash([]);
      ctxRef.current.lineCap   = 'round';
      ctxRef.current.lineJoin  = 'round';
      ctxRef.current.strokeStyle = color;
      ctxRef.current.lineWidth = stroke;
      ctxRef.current.globalAlpha = tool === TOOLS.HIGHLIGHTER ? 0.3 : 1.0;

      // Proper midpoint-smoothing: draw from lastMid → currentMid using lastPos
      // as the quadratic control point. Consecutive segments share endpoints
      // (both end/start at a midpoint) → perfectly continuous, zero gaps.
      const currentMid = {
        x: (lastPos.current.x + pos.x) / 2,
        y: (lastPos.current.y + pos.y) / 2,
      };
      const from = lastMid.current || lastPos.current;
      ctxRef.current.beginPath();
      ctxRef.current.moveTo(from.x, from.y);
      ctxRef.current.quadraticCurveTo(lastPos.current.x, lastPos.current.y, currentMid.x, currentMid.y);
      ctxRef.current.stroke();
      ctxRef.current.globalAlpha = 1.0;

      lastMid.current = currentMid; // advance for next segment
      emitStroke(lastPos.current.x, lastPos.current.y, pos.x, pos.y, tool);
    } else if (tool === TOOLS.ERASER) {
      ctxRef.current.setLineDash([]);
      ctxRef.current.lineCap   = 'round';
      ctxRef.current.lineJoin  = 'round';
      ctxRef.current.strokeStyle = "#ffffff";
      ctxRef.current.lineWidth = stroke * 4;
      ctxRef.current.beginPath();
      ctxRef.current.moveTo(lastPos.current.x, lastPos.current.y);
      ctxRef.current.lineTo(pos.x, pos.y);
      ctxRef.current.stroke();
      emitStroke(lastPos.current.x, lastPos.current.y, pos.x, pos.y, tool);
    }

    if (isShapeTool(tool) && isPainting.current && socket) {
      // Throttled preview emit (every 3rd move approx)
      if (Math.random() > 0.7) {
        socket.emit("draw-shape", { code: sessionCode, tool, start: startPos.current, end: pos, color, stroke, isPreview: true });
      }
    }

    lastPos.current = pos;

    // Throttled drawing-cursor emit — lets others see who is writing (≤30fps)
    if (socket && name && isPainting.current) {
      const now = Date.now();
      if (now - drawCursorThrottle.current >= 33) {
        drawCursorThrottle.current = now;
        socket.emit("drawing-cursor", { code: sessionCode, name, x: pos.x, y: pos.y });
      }
    }
  }; // end processMoveEvent


  const onUp = (e) => {
    if (isPanningCanvas.current) {
      isPanningCanvas.current = false;
      try { e.currentTarget?.releasePointerCapture(e.pointerId); } catch {}
      return;
    }

    if (!isPainting.current && !isDraggingSelection.current && !isResizingSelection.current && !isRotatingSelection.current) return;
    const pos = getPos(e);

    // ── Selection drag / resize / rotate end ────────────────────────────────
    if (isDraggingSelection.current || isResizingSelection.current || isRotatingSelection.current) {
      isDraggingSelection.current = false;
      isResizingSelection.current = false;
      isRotatingSelection.current = false;
      if (liveSelectionRef.current) setSelection({ ...liveSelectionRef.current });
      // Defer toDataURL so it doesn't block pointer events for the next stroke
      setTimeout(() => emitCanvas(), 0);
      return;
    }

    // Mark painting finished BEFORE anything async
    const wasPainting = isPainting.current;
    isPainting.current = false;

    if (tool === TOOLS.LASER) {
      if (socket) socket.emit("laser-stop", { code: sessionCode });
      return;
    }

    if (isShapeTool(tool)) {
      ctxRef.current.putImageData(snapshotRef.current, 0, 0);
      drawShape(ctxRef.current, tool, startPos.current, pos, color, stroke);
      if (socket) {
        socket.emit("draw-shape", { code: sessionCode, tool, start: startPos.current, end: pos, color, stroke, isPreview: false });
      }
      if (tool === TOOLS.LINE) emitStroke(startPos.current.x, startPos.current.y, pos.x, pos.y, tool);
      // Defer heavy toDataURL so next letter's pointerdown isn't delayed
      setTimeout(() => emitCanvas(), 0);
    } else if (isSelectionTool(tool)) {
      if (liveSelectionRef.current) {
        setSelection({ ...liveSelectionRef.current });
        if (tool === TOOLS.SELECT) {
          const w = Math.abs(pos.x - startPos.current.x);
          const h = Math.abs(pos.y - startPos.current.y);
          const x = Math.min(pos.x, startPos.current.x);
          const y = Math.min(pos.y, startPos.current.y);
          if (w > 5 && h > 5) {
            const imgData = ctxRef.current.getImageData(x, y, w, h);
            setSelection({ type: TOOLS.SELECT, x, y, w, h, imgData, isCut: false });
          }
        } else if (tool === TOOLS.LASSO) {
          if (lassoPath.current.length > 2) {
            const xs = lassoPath.current.map(p => p.x);
            const ys = lassoPath.current.map(p => p.y);
            const minX = Math.min(...xs); const maxX = Math.max(...xs);
            const minY = Math.min(...ys); const maxY = Math.max(...ys);
            const w = maxX - minX; const h = maxY - minY;
            if (w > 5 && h > 5) {
              const originalData = ctxRef.current.getImageData(minX, minY, w, h);
              const offCanvas = document.createElement("canvas");
              offCanvas.width = w; offCanvas.height = h;
              const offCtx = offCanvas.getContext("2d");
              offCtx.beginPath();
              lassoPath.current.forEach((p, i) => { if (i === 0) offCtx.moveTo(p.x - minX, p.y - minY); else offCtx.lineTo(p.x - minX, p.y - minY); });
              offCtx.closePath(); offCtx.clip();
              const srcCanvas = document.createElement("canvas");
              srcCanvas.width = w; srcCanvas.height = h;
              srcCanvas.getContext("2d").putImageData(originalData, 0, 0);
              offCtx.drawImage(srcCanvas, 0, 0);
              const maskedData = offCtx.getImageData(0, 0, w, h);
              setSelection({ type: TOOLS.LASSO, x: minX, y: minY, w, h, imgData: maskedData, isCut: false, path: [...lassoPath.current] });
            }
          }
        }
      }
    } else if (wasPainting) {
      // Pen / eraser / highlighter — strokes already emitted per-segment via emitStroke.
      // Emit full canvas state deferred so it doesn't block the next pointerdown.
      setTimeout(() => emitCanvas(), 0);
    }

    // Reset path for next stroke (important for ctx state cleanliness)
    ctxRef.current.beginPath();
    snapshotRef.current = null;
    lastMid.current = null;

    // Notify others that this user stopped drawing
    if (socket) socket.emit("drawing-stop", { code: sessionCode });
  };

// ── Chat ─────────────────────────────────────────────────────────────────
const addSystemChat = (msg) => {
  setChats((prev) => [...prev, { sender: "system", message: msg, role: "system", timestamp: new Date().toISOString() }]);
};

const sendChat = () => {
  if (!chatInput.trim() || !socket) return;
  socket.emit("session-chat", { code: sessionCode, message: chatInput, sender: name, role });
  setChatInput("");
};

// ── Teacher actions ──────────────────────────────────────────────────────
const handleClearCanvas = () => {
  if (!socket) return;
  socket.emit("clear-canvas", { code: sessionCode });
  const ctx = ctxRef.current;
  if (ctx && canvasRef.current)
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
};

const handleSaveSnapshot = () => {
  if (!canvasRef.current || role !== "teacher") return;
  // Quality 0.55 — good enough for history review, saves ~60% storage vs 0.85
  const dataURL = getWhiteBackgroundDataURL(canvasRef.current, 0.55, liveSelectionRef.current);
  socket.emit("save-snapshot", { code: sessionCode, dataURL });
  showToast("📸 Snapshot saved to history.");
};

const handleExportPDF = () => {
  if (!canvasRef.current) return;
  const canvas = canvasRef.current;
  const imgData = getWhiteBackgroundDataURL(canvas, 0.95, liveSelectionRef.current);
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? "l" : "p",
    unit: "px",
    format: [canvas.width, canvas.height]
  });
  pdf.addImage(imgData, "JPEG", 0, 0, canvas.width, canvas.height);
  pdf.save(`ClassBoard_${sessionInfo?.title || "Session"}.pdf`);
};

const handleEndSession = () => {
  if (!socket || !canvasRef.current) return;
  const code = sessionCodeRef.current || sessionCode;
  if (!code) { showToast('⚠️ No active session to end.'); return; }
  if (!window.confirm('End this class session for everyone?')) return;
  const finalDataURL = getWhiteBackgroundDataURL(canvasRef.current, 0.7, liveSelectionRef.current);
  socket.emit('end-session', { code, finalDataURL });
  localStorage.removeItem('classboard_session'); // clear so next visit starts fresh
};

const handleKick = (targetId) => {
  if (!socket) return;
  socket.emit("kick-member", { code: sessionCode, targetId });
};

const handleMuteStudent = (targetId, muted) => {
  if (!socket) return;
  socket.emit("mute-student", { code: sessionCode, targetId, muted });
  setActiveStudentMenu(null);
};

const handleLockClass = () => {
  if (!socket) return;
  socket.emit("lock-class", { code: sessionCode });
  setClassLocked(true);
  setIsLeftMenuOpen(false);
  showToast("🔒 All students muted — teacher-only mode.");
};

const handleUnlockClass = () => {
  if (!socket) return;
  socket.emit("unlock-class", { code: sessionCode });
  setClassLocked(false);
  setIsLeftMenuOpen(false);
  showToast("🔓 All students can draw again.");
};

const handleTempBan = (targetId, minutes) => {
  if (!socket) return;
  if (!window.confirm(`Temporarily ban this student for ${minutes} minutes?`)) return;
  socket.emit("temp-ban-student", { code: sessionCode, targetId, minutes });
  setActiveStudentMenu(null);
};

const handlePermBan = (targetId) => {
  if (!socket) return;
  if (!window.confirm("Permanently ban this student? They will never be able to rejoin this session.")) return;
  socket.emit("perm-ban-student", { code: sessionCode, targetId });
  setActiveStudentMenu(null);
};

const copyCode = () => {
  navigator.clipboard.writeText(sessionCode).then(() => showToast("Code copied!"));
};

const handleFileUpload = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.type.startsWith("image/")) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxW = 800;
      const maxH = 800;
      let w = img.width;
      let h = img.height;
      if (w > maxW) { h *= maxW / w; w = maxW; }
      if (h > maxH) { w *= maxH / h; h = maxH; }

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = w;
      tempCanvas.height = h;
      tempCanvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const imgData = tempCanvas.getContext("2d").getImageData(0, 0, w, h);

      setSelection({ type: TOOLS.SELECT, x: 50, y: 50, w, h, imgData, isCut: true, rotation: 0 });
      setTool(TOOLS.SELECT);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  } else if (file.type === "application/pdf") {
    try {
      const loadPdfJs = () => {
        return new Promise((resolve, reject) => {
          if (window.pdfjsLib) {
            resolve(window.pdfjsLib);
            return;
          }
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          script.onload = () => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            resolve(window.pdfjsLib);
          };
          script.onerror = reject;
          document.head.appendChild(script);
        });
      };

      const pdfjsLib = await loadPdfJs();

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;
      showToast(`Processing ${numPages} pages...`);

      const pages = [];
      let totalW = 0;
      let totalH = 0;

      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;
        await page.render({ canvasContext: tempCanvas.getContext("2d"), viewport }).promise;

        pages.push(tempCanvas);
        totalW = Math.max(totalW, viewport.width);
        totalH += viewport.height + 20;
        if (totalH > 15000) break; // Safety limit
      }

      const combinedCanvas = document.createElement("canvas");
      combinedCanvas.width = totalW;
      combinedCanvas.height = totalH;
      const combinedCtx = combinedCanvas.getContext("2d");

      let currentY = 0;
      for (const p of pages) {
        combinedCtx.drawImage(p, (totalW - p.width) / 2, currentY);
        currentY += p.height + 20;
      }

      const imgData = combinedCtx.getImageData(0, 0, combinedCanvas.width, combinedCanvas.height);

      setSelection({ type: TOOLS.SELECT, x: 50, y: 50, w: combinedCanvas.width, h: combinedCanvas.height, imgData, isCut: true, rotation: 0, scale: 0.7 });
      setTool(TOOLS.SELECT);
      showToast(`PDF added (${pages.length} pages)`);
    } catch (err) {
      console.error(err);
      showToast("Error loading PDF");
    }
  }
  e.target.value = "";
};

// ── Kicked screen ────────────────────────────────────────────────────────
if (kicked) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "Inter, sans-serif", gap: "16px" }}>
      <div style={{ fontSize: "64px" }}>🚫</div>
      <h2 style={{ color: "#ef4444" }}>You were removed from the session</h2>
      <button className="home-btn primary" style={{ width: "auto", padding: "10px 28px" }} onClick={() => navigate("/")}>← Back to Home</button>
    </div>
  );
}

// ── Banned screen ────────────────────────────────────────────────────────
if (banned) {
  const isPerm = banned.type === "perm";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "Inter, sans-serif", gap: "16px" }}>
      <div style={{ fontSize: "64px" }}>{isPerm ? "⛔" : "⏳"}</div>
      <h2 style={{ color: isPerm ? "#ef4444" : "#f59e0b" }}>
        {isPerm ? "Permanently Banned" : `Temporarily Banned (⏳${banned.minutes} min)`}
      </h2>
      <p style={{ color: "#8b949e", textAlign: "center", maxWidth: "380px" }}>
        {isPerm
          ? "The teacher has permanently removed you from this session. You cannot rejoin."
          : `You have been banned for ${banned.minutes} minute(s). You may try rejoining after the duration.`}
      </p>
      <button className="home-btn primary" style={{ width: "auto", padding: "10px 28px" }} onClick={() => navigate("/")}>← Back to Home</button>
    </div>
  );
}

// ── Shared dropdown item style ────────────────────────────────────────────────
const menuItemStyle = (accentColor) => ({
  display: "block", width: "100%", padding: "9px 14px",
  background: "transparent", border: "none",
  color: accentColor, cursor: "pointer", fontSize: "13px",
  textAlign: "left", transition: "background 0.15s",
  fontFamily: "inherit",
});

return (
  <div className="classroom">
    {/* ── Right Hamburger Drawer ── */}
    {isLeftMenuOpen && (
      <div
        onClick={() => setIsLeftMenuOpen(false)}
        style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)"
        }}
      />
    )}
    <aside style={{
      position: "fixed", top: 0, right: 0, height: "100vh", width: "240px",
      background: "linear-gradient(180deg, #0d1117 0%, #161b22 100%)",
      borderLeft: "1px solid var(--border)",
      zIndex: 1001,
      transform: isLeftMenuOpen ? "translateX(0)" : "translateX(100%)",
      transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)",
      display: "flex", flexDirection: "column",
      boxShadow: isLeftMenuOpen ? "-6px 0 32px rgba(0,0,0,0.6)" : "none"
    }}>
      {/* Drawer Header */}
      <div style={{
        padding: "20px 16px 16px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between"
      }}>
        <span style={{ fontWeight: "700", fontSize: "15px", color: "var(--text1)", letterSpacing: "0.5px" }}>⚡ Menu</span>
        <button
          onClick={() => setIsLeftMenuOpen(false)}
          style={{ background: "transparent", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: "18px", lineHeight: 1 }}
        >✕</button>
      </div>

      {/* Drawer Options */}
      <nav style={{ flex: 1, padding: "16px 10px", display: "flex", flexDirection: "column", gap: "6px" }}>
        {/* Export PDF */}
        <button
          onClick={() => { handleExportPDF(); setIsLeftMenuOpen(false); }}
          style={{
            display: "flex", alignItems: "center", gap: "12px",
            padding: "12px 14px", borderRadius: "10px",
            background: "rgba(79,142,247,0.08)", border: "1px solid rgba(79,142,247,0.18)",
            color: "var(--text1)", cursor: "pointer", fontSize: "14px", fontWeight: "500",
            transition: "background 0.2s", width: "100%", textAlign: "left"
          }}
          onMouseEnter={e => e.currentTarget.style.background="rgba(79,142,247,0.18)"}
          onMouseLeave={e => e.currentTarget.style.background="rgba(79,142,247,0.08)"}
        >
          <FileDown size={18} style={{ color: "#4f8ef7" }} />
          Export PDF
        </button>

        {/* Save Snapshot */}
        <button
          onClick={() => { handleSaveSnapshot(); setIsLeftMenuOpen(false); }}
          style={{
            display: "flex", alignItems: "center", gap: "12px",
            padding: "12px 14px", borderRadius: "10px",
            background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.18)",
            color: "var(--text1)", cursor: "pointer", fontSize: "14px", fontWeight: "500",
            transition: "background 0.2s", width: "100%", textAlign: "left"
          }}
          onMouseEnter={e => e.currentTarget.style.background="rgba(74,222,128,0.18)"}
          onMouseLeave={e => e.currentTarget.style.background="rgba(74,222,128,0.08)"}
        >
          <Save size={18} style={{ color: "#4ade80" }} />
          Save Snapshot
        </button>

        {/* Insert Image */}
        <button
          onClick={() => { setIsLeftMenuOpen(false); setTimeout(() => document.getElementById("canvas-image-upload").click(), 100); }}
          style={{
            display: "flex", alignItems: "center", gap: "12px",
            padding: "12px 14px", borderRadius: "10px",
            background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)",
            color: "var(--text1)", cursor: "pointer", fontSize: "14px", fontWeight: "500",
            transition: "background 0.2s", width: "100%", textAlign: "left"
          }}
          onMouseEnter={e => e.currentTarget.style.background="rgba(168,85,247,0.18)"}
          onMouseLeave={e => e.currentTarget.style.background="rgba(168,85,247,0.08)"}
        >
          <ImagePlus size={18} style={{ color: "#a855f7" }} />
          Insert Image
        </button>

        {/* Insert PDF */}
        <button
          onClick={() => { setIsLeftMenuOpen(false); setTimeout(() => document.getElementById("canvas-pdf-upload").click(), 100); }}
          style={{
            display: "flex", alignItems: "center", gap: "12px",
            padding: "12px 14px", borderRadius: "10px",
            background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.2)",
            color: "var(--text1)", cursor: "pointer", fontSize: "14px", fontWeight: "500",
            transition: "background 0.2s", width: "100%", textAlign: "left"
          }}
          onMouseEnter={e => e.currentTarget.style.background="rgba(249,115,22,0.18)"}
          onMouseLeave={e => e.currentTarget.style.background="rgba(249,115,22,0.08)"}
        >
          <FilePlus2 size={18} style={{ color: "#f97316" }} />
          Insert PDF to Board
        </button>

        {/* Lock / Unlock all students — teacher only */}
        {role === "teacher" && (
          <button
            onClick={classLocked ? handleUnlockClass : handleLockClass}
            style={{
              display: "flex", alignItems: "center", gap: "12px",
              padding: "12px 14px", borderRadius: "10px",
              background: classLocked ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.06)",
              border: classLocked ? "1px solid rgba(245,158,11,0.45)" : "1px solid rgba(245,158,11,0.2)",
              color: "var(--text1)", cursor: "pointer", fontSize: "14px", fontWeight: "500",
              transition: "background 0.2s", width: "100%", textAlign: "left"
            }}
            onMouseEnter={e => e.currentTarget.style.background="rgba(245,158,11,0.2)"}
            onMouseLeave={e => e.currentTarget.style.background= classLocked ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.06)"}
            title={classLocked ? "Allow all students to draw" : "Block all students from drawing"}
          >
            <span style={{ fontSize: 18 }}>{classLocked ? "🔓" : "🔒"}</span>
            {classLocked ? "Unlock All Students" : "Lock All Students"}
            {classLocked && <span style={{ marginLeft: "auto", fontSize: 10, background: "rgba(245,158,11,0.25)", padding: "2px 7px", borderRadius: 8, color: "#f59e0b" }}>LOCKED</span>}
          </button>
        )}

        {/* End Class — teacher only */}
        {role === "teacher" && (
          <button
            onClick={() => { handleEndSession(); setIsLeftMenuOpen(false); }}
            style={{
              display: "flex", alignItems: "center", gap: "12px",
              padding: "12px 14px", borderRadius: "10px",
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)",
              color: "var(--text1)", cursor: "pointer", fontSize: "14px", fontWeight: "500",
              transition: "background 0.2s", width: "100%", textAlign: "left"
            }}
            onMouseEnter={e => e.currentTarget.style.background="rgba(239,68,68,0.18)"}
            onMouseLeave={e => e.currentTarget.style.background="rgba(239,68,68,0.08)"}
          >
            <LogOut size={18} style={{ color: "#ef4444" }} />
            End Class
          </button>
        )}

        {/* Leave Session */}
        <button
          onClick={() => { localStorage.removeItem('classboard_session'); navigate("/"); }}
          style={{
            display: "flex", alignItems: "center", gap: "12px",
            padding: "12px 14px", borderRadius: "10px",
            background: "rgba(148,163,184,0.06)", border: "1px solid rgba(148,163,184,0.15)",
            color: "var(--text1)", cursor: "pointer", fontSize: "14px", fontWeight: "500",
            transition: "background 0.2s", width: "100%", textAlign: "left"
          }}
          onMouseEnter={e => e.currentTarget.style.background="rgba(148,163,184,0.14)"}
          onMouseLeave={e => e.currentTarget.style.background="rgba(148,163,184,0.06)"}
        >
          <ArrowLeft size={18} style={{ color: "#94a3b8" }} />
          Leave Session
        </button>
      </nav>

      {/* Bottom role / session info */}
      {sessionCode && (
        <div style={{
          padding: "14px 16px",
          borderTop: "1px solid var(--border)",
          fontSize: "12px", color: "var(--text3)"
        }}>
          Session: <strong style={{ color: "var(--text1)" }}>{sessionCode}</strong>
        </div>
      )}
    </aside>

    {/* ── Combined Header + Toolbar (single row on desktop) ── */}
    <header className="classroom-header">

      {/* LEFT: Sidebar toggle */}
      <div className="classroom-title-area" style={{ flexShrink: 0 }}>
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          style={{ background: "transparent", border: "none", color: "var(--text1)", fontSize: "24px", cursor: "pointer", position: "relative", display: "flex", alignItems: "center" }}
          title="Toggle Chat & Participants"
        >
          <Menu size={24} />
          {unreadCount > 0 && (
            <span style={{ position: "absolute", top: "-5px", right: "-10px", background: "#ef4444", color: "#fff", fontSize: "10px", padding: "2px 5px", borderRadius: "10px", fontWeight: "bold" }}>
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* CENTRE: Drawing Toolbar — scrollable, fills available space */}
      <div className="toolbar-inline">
        {/* Drawing tools */}
        <div className="toolbar-group">
          {[
            { id: TOOLS.SELECT,     label: <MousePointer2 size={17} />, title: "Select" },
            { id: TOOLS.LASSO,      label: <Move size={17} />,          title: "Lasso Select" },
            { id: TOOLS.PAN,        label: <Hand size={17} />,          title: "Pan / Hand Tool (Drag to Scroll)" },
            { id: TOOLS.PEN,        label: <PenTool size={17} />,       title: "Pen" },
            { id: TOOLS.HIGHLIGHTER,label: <Highlighter size={17} />,   title: "Highlighter" },
            { id: TOOLS.ERASER,     label: <Eraser size={17} />,        title: "Eraser" },
            { id: TOOLS.OBJ_ERASER, label: <Wand2 size={17} />,         title: "Object Eraser" },
            { id: TOOLS.CIRCLE,     label: <Circle size={17} />,        title: "Circle" },
            { id: TOOLS.RECTANGLE,  label: <Square size={17} />,        title: "Rectangle" },
          ].map((t) => (
            <React.Fragment key={t.id}>
              <button className={`tool-btn ${tool === t.id ? "active" : ""}`} title={t.title} onClick={() => setTool(t.id)}>
                {t.label}
              </button>
              {t.id === TOOLS.ERASER && role === "teacher" && (
                <button className="tool-btn" onClick={handleClearCanvas} title="Clear Board"><Trash2 size={17} /></button>
              )}
            </React.Fragment>
          ))}

          {/* More shapes dropdown */}
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <button
              className={`tool-btn ${[TOOLS.LINE, TOOLS.SQUARE, TOOLS.TRIANGLE, TOOLS.HEXAGON].includes(tool) ? "active" : ""}`}
              title="More Shapes"
              onClick={(e) => {
                if (!showMoreShapes) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setShapeMenuCoords({ top: rect.bottom + 8, left: rect.left - 20 });
                }
                setShowMoreShapes(!showMoreShapes);
              }}
              style={{ fontSize: "10px", padding: "0 4px", color: "var(--text3)" }}
            >
              {showMoreShapes ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showMoreShapes && createPortal(
              <div style={{ position: "fixed", top: shapeMenuCoords.top, left: shapeMenuCoords.left, display: "flex", flexDirection: "column", gap: "4px", background: "var(--bg2)", padding: "6px", borderRadius: "8px", border: "1px solid var(--border)", zIndex: 9999, boxShadow: "0 8px 24px rgba(0,0,0,0.6)" }}>
                {[
                  { id: TOOLS.LINE,     label: <Minus size={17} />,    title: "Straight line" },
                  { id: TOOLS.SQUARE,   label: <Square size={17} />,   title: "Square" },
                  { id: TOOLS.TRIANGLE, label: <Triangle size={17} />, title: "Triangle" },
                  { id: TOOLS.HEXAGON,  label: <Hexagon size={17} />,  title: "Hexagon" },
                ].map(t => (
                  <button key={t.id} className={`tool-btn ${tool === t.id ? "active" : ""}`} title={t.title}
                    onClick={() => { setTool(t.id); setShowMoreShapes(false); }}
                    style={{ width: "100%", justifyContent: "center" }}>
                    {t.label}
                  </button>
                ))}
              </div>,
              document.body
            )}
          </div>

          {/* Laser pointer */}
          <button className={`tool-btn ${tool === TOOLS.LASER ? "active" : ""}`} title="Laser Pointer" onClick={() => setTool(TOOLS.LASER)}>
            <Zap size={17} />
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Color palette */}
        <div className="color-dot">
          {COLORS.map((c) => (
            <div key={c} className={`color-swatch ${color === c ? "active" : ""}`}
              style={{ background: c, border: c === "#ffffff" ? "2px solid #555" : "2px solid transparent" }}
              onClick={() => { setColor(c); setTool(TOOLS.PEN); }} title={c}
            />
          ))}
          <input type="color" value={color}
            onChange={(e) => { setColor(e.target.value); setTool(TOOLS.PEN); }}
            style={{ width: "20px", height: "20px", border: "none", background: "transparent", cursor: "pointer", borderRadius: "50%", overflow: "hidden" }}
            title="Custom color"
          />
        </div>

        <div className="toolbar-divider" />

        {/* Stroke size */}
        <span style={{ fontSize: "10px", color: "var(--text3)", fontWeight: "600", textTransform: "uppercase", whiteSpace: "nowrap" }}>Size</span>
        <input className="stroke-slider" type="range" min={1} max={30} value={stroke} onChange={(e) => setStroke(parseInt(e.target.value))} />

        <div className="toolbar-divider" />

        {/* Palm rejection / Stylus mode toggle */}
        <button
          onClick={() => {
            const next = !pencilOnly;
            setPencilOnly(next);
            if (!next) stylusDetected.current = false;
          }}
          title={
            pencilOnly
              ? stylusDetected.current
                ? 'Stylus Auto-Detected — Palm Rejection ON. Tap to disable.'
                : 'Palm Rejection ON. Tap to disable.'
              : 'Palm Rejection OFF — will auto-enable when stylus is detected'
          }
          style={{
            background: pencilOnly ? "rgba(79,142,247,0.2)" : "transparent",
            border: pencilOnly ? "1px solid rgba(79,142,247,0.5)" : "1px solid transparent",
            borderRadius: "6px", padding: "3px 7px", cursor: "pointer",
            fontSize: "14px", lineHeight: 1, flexShrink: 0,
            color: pencilOnly ? "#4f8ef7" : "var(--text3)",
            display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s",
          }}
        >
          ✏️
          {pencilOnly && (
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>
              {stylusDetected.current ? 'AUTO' : 'ONLY'}
            </span>
          )}
        </button>

        {/* Hidden file inputs */}
        <input id="canvas-image-upload" type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileUpload} />
        <input id="canvas-pdf-upload" type="file" accept="application/pdf" style={{ display: "none" }} onChange={handleFileUpload} />
      </div>

      {/* RIGHT: Zoom, session code, hamburger */}
      <div className="classroom-header-btns" style={{ flexShrink: 0 }}>
        {snapshotSaved && (
          <span style={{ fontSize: "12px", color: "#4ade80" }}>✓ Saved {snapshotSaved}</span>
        )}
        <button className="hdr-btn" onClick={() => {
          const elem = document.documentElement;
          const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
          if (!isFullscreen) {
            if (elem.requestFullscreen) elem.requestFullscreen().catch(err => alert(`Fullscreen error: ${err.message}`));
            else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
            else if (elem.mozRequestFullScreen) elem.mozRequestFullScreen();
            else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
          } else {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
            else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
            else if (document.msExitFullscreen) document.msExitFullscreen();
          }
        }}>
          <Maximize size={18} />
        </button>

        <div className="zoom-controls" style={{ display: "flex", alignItems: "center", background: "var(--bg3)", borderRadius: "8px", padding: "2px 8px", border: "1px solid var(--border)", gap: "8px" }}>
          <button className="zoom-btn" onClick={() => setZoom(Math.max(0.01, zoom - 0.1))} style={{ background: "transparent", border: "none", color: "var(--text2)", cursor: "pointer", fontSize: "18px" }}>-</button>
          <span style={{ fontSize: "12px", color: "var(--text)", minWidth: "45px", textAlign: "center", fontWeight: "bold" }}>{Math.round(zoom * 100)}%</span>
          <button className="zoom-btn" onClick={() => setZoom(Math.min(10.0, zoom + 0.1))} style={{ background: "transparent", border: "none", color: "var(--text2)", cursor: "pointer", fontSize: "18px" }}>+</button>
          <button className="zoom-btn" onClick={() => setZoom(1.0)} style={{ background: "rgba(79,142,247,0.1)", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "10px", padding: "4px 8px", borderRadius: "4px" }}>Reset</button>
        </div>

        {sessionCode ? (
          <span className="classroom-code-badge" onClick={copyCode} title="Click to copy session code"
            style={{ padding: "6px 12px", fontSize: "12px", letterSpacing: "2px", cursor: "pointer" }}>
            <Copy size={13} /> {sessionCode}
          </span>
        ) : (
          <span style={{ fontSize: "11px", color: "var(--text3)", padding: "6px 8px" }}>Connecting...</span>
        )}

        {/* Right hamburger */}
        <button
          onClick={() => setIsLeftMenuOpen(true)}
          style={{
            background: "transparent", border: "none", color: "var(--text1)",
            cursor: "pointer", display: "flex", alignItems: "center",
            padding: "6px", borderRadius: "8px", transition: "background 0.2s"
          }}
          title="Open Menu"
          onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.07)"}
          onMouseLeave={e => e.currentTarget.style.background="transparent"}
        >
          <Menu size={22} />
        </button>
      </div>
    </header>


    <div className="classroom-body">
      {/* ── Sidebar ── */}
      {isSidebarOpen && (
        <aside className="classroom-sidebar">

          <div className="sidebar-section">
            <h3>Participants ({members.length})</h3>
            {members.map((m) => (
              <div className="participant-item" key={m.id} style={{ position: "relative" }}>
                <div className={`participant-avatar ${m.role}`}>
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <div className="participant-info">
                  <div className="participant-name">
                    {m.name} {m.id === socket?.id ? "(you)" : ""}
                    {m.muted && <span style={{ marginLeft: 6, fontSize: 10, color: "#f59e0b", background: "rgba(245,158,11,0.15)", padding: "1px 5px", borderRadius: 4 }}>muted</span>}
                  </div>
                  <div className="participant-role">{m.role}</div>
                </div>
                {role === "teacher" && m.role !== "teacher" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
                    {/* Quick Allow/Revoke button when class is locked */}
                    {classLocked && (
                      <button
                        onClick={() => handleMuteStudent(m.id, m.muted)}
                        title={m.muted ? "Allow this student to draw" : "Revoke draw permission"}
                        style={{
                          background: m.muted ? "rgba(74,222,128,0.1)" : "rgba(245,158,11,0.1)",
                          border: m.muted ? "1px solid rgba(74,222,128,0.3)" : "1px solid rgba(245,158,11,0.3)",
                          color: m.muted ? "#4ade80" : "#f59e0b",
                          borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap"
                        }}
                      >
                        {m.muted ? "✋ Allow" : "🔇 Revoke"}
                      </button>
                    )}
                    {/* ⋯ full menu */}
                    <button
                      className="kick-btn"
                      title="Manage student"
                      onClick={() => setActiveStudentMenu(activeStudentMenu === m.id ? null : m.id)}
                      style={{ background: "rgba(255,255,255,0.07)", border: "1px solid var(--border)", color: "var(--text2)", borderRadius: 6, padding: "3px 7px", cursor: "pointer", fontSize: 14 }}
                    >⋯</button>

                    {activeStudentMenu === m.id && (
                      <div style={{
                        position: "absolute", right: 0, top: "110%", zIndex: 9999,
                        background: "#1c2128", border: "1px solid var(--border)",
                        borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                        minWidth: 200, overflow: "hidden"
                      }}>
                        {/* Mute / Unmute */}
                        <button onClick={() => handleMuteStudent(m.id, !m.muted)} style={menuItemStyle("#f59e0b")}>
                          {m.muted ? "🔊 Allow Drawing" : "🔇 Mute (Disallow Drawing)"}
                        </button>
                        <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
                        {/* Temp ban options */}
                        <div style={{ padding: "4px 10px", fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1 }}>Temporary Ban</div>
                        {[5, 15, 30].map(mins => (
                          <button key={mins} onClick={() => handleTempBan(m.id, mins)} style={menuItemStyle("#fb923c")}>
                            ⏳ Ban for {mins} min
                          </button>
                        ))}
                        <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
                        {/* Perm ban */}
                        <button onClick={() => handlePermBan(m.id)} style={menuItemStyle("#ef4444")}>
                          ⛔ Permanent Ban
                        </button>
                        <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
                        {/* Kick */}
                        <button onClick={() => { handleKick(m.id); setActiveStudentMenu(null); }} style={menuItemStyle("#94a3b8")}>
                          ✕ Kick (Remove)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Chat */}
          <div className="chat-area">
            <div className="chat-messages">
              {chats.length === 0 && (
                <div className="empty-state">
                  <div className="icon">💬</div>
                  <p>Chat will appear here</p>
                </div>
              )}
              {chats.map((c, i) => (
                <div key={i} className={`chat-msg ${c.role === "system" ? "system-msg" : c.role === "teacher" ? "teacher-msg" : "student-msg"}`}>
                  {c.role !== "system" && (
                    <div className={`chat-sender ${c.role}`}>{c.sender}</div>
                  )}
                  {c.message}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-input-row">
              <input
                className="chat-input"
                placeholder="Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
              />
              <button className="chat-send-btn" onClick={sendChat}>➤</button>
            </div>
          </div>
        </aside>
      )}

      {/* ── Whiteboard ── */}
      <div className="whiteboard-area">
        {/* Toolbar moved to header */}

        {/* Canvas */}
        <div ref={canvasWrapperRef} className="canvas-wrapper">
          <div style={{
            position: "relative",
            width: 3000 * zoom,
            height: 10000 * zoom,
            background: "#ffffff",
            transition: "width 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), height 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)"
          }}>
            <div style={{
              transform: `scale(${zoom})`,
              transformOrigin: "0 0",
              width: 3000,
              height: 10000,
              position: "absolute",
              top: 0,
              left: 0,
              transition: "transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)"
            }}>
              {selection && (
                <div
                  ref={selectionDivRef}
                  style={{
                    position: "absolute",
                    left: selection.x,
                    top: selection.y,
                    width: selection.w,
                    height: selection.h,
                    transform: `rotate(${selection.rotation || 0}rad) scale(${selection.scale || 1})`,
                    transformOrigin: "center center",
                    zIndex: 50,
                    pointerEvents: "none",
                  }}
                >
                  <canvas
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "1px dashed #3b82f6",
                    }}
                    width={selection.w}
                    height={selection.h}
                    ref={selCanvasRef}
                  />

                  {/* Resize Handles */}
                  {['tl', 'tr', 'bl', 'br'].map(corner => {
                    const invScale = 1 / (selection.scale || 1);
                    const size = 14 * invScale;
                    const offset = -7 * invScale;
                    return (
                      <div
                        key={corner}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          isResizingSelection.current = true;
                        }}
                        style={{
                          position: "absolute",
                          ...(corner.includes('t') ? { top: offset } : { bottom: offset }),
                          ...(corner.includes('l') ? { left: offset } : { right: offset }),
                          width: size,
                          height: size,
                          background: "#ffffff",
                          border: `${2 * invScale}px solid #3b82f6`,
                          cursor: "crosshair",
                          pointerEvents: "auto",
                          boxShadow: `0 ${2 * invScale}px ${4 * invScale}px rgba(0,0,0,0.2)`
                        }}
                        title="Drag to resize"
                      />
                    );
                  })}

                  {/* Rotation handle */}
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      isRotatingSelection.current = true;
                    }}
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: -30 * (1 / (selection.scale || 1)),
                      width: 16 * (1 / (selection.scale || 1)),
                      height: 16 * (1 / (selection.scale || 1)),
                      transform: "translateX(-50%)",
                      background: "#3b82f6",
                      borderRadius: "50%",
                      border: `${2 * (1 / (selection.scale || 1))}px solid #fff`,
                      cursor: "grab",
                      pointerEvents: "auto",
                      boxShadow: `0 ${2 * (1 / (selection.scale || 1))}px ${4 * (1 / (selection.scale || 1))}px rgba(0,0,0,0.2)`
                    }}
                    title="Drag to rotate"
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: -14 * (1 / (selection.scale || 1)),
                      width: 2 * (1 / (selection.scale || 1)),
                      height: 14 * (1 / (selection.scale || 1)),
                      background: "#3b82f6",
                      transform: "translateX(-50%)",
                    }}
                  />
                </div>
              )}
              {Object.entries(lasers).map(([id, l]) => (
                <div key={id} style={{
                  position: "absolute",
                  left: l.x,
                  top: l.y,
                  width: "16px",
                  height: "16px",
                  background: l.color || "#ef4444",
                  borderRadius: "50%",
                  transform: "translate(-50%, -50%)",
                  boxShadow: `0 0 16px ${l.color || "#ef4444"}`,
                  pointerEvents: "none",
                  zIndex: 100,
                  transition: "left 0.05s linear, top 0.05s linear"
                }} />
              ))}
              {/* ── Who is writing: floating name badges ────────────────── */}
              {Object.entries(remoteDrawers).map(([id, d]) => (
                <div
                  key={id}
                  style={{
                    position: "absolute",
                    left: d.x,
                    top: d.y,
                    pointerEvents: "none",
                    zIndex: 120,
                    transform: "translate(12px, -32px)",
                    transition: "left 0.04s linear, top 0.04s linear",
                  }}
                >
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    background: "rgba(10,14,22,0.88)",
                    border: "1px solid rgba(79,142,247,0.45)",
                    borderRadius: 8,
                    padding: "4px 9px",
                    boxShadow: "0 3px 12px rgba(0,0,0,0.5)",
                    backdropFilter: "blur(6px)",
                    whiteSpace: "nowrap",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#e2e8f0",
                    letterSpacing: 0.3,
                  }}>
                    <span style={{ fontSize: 14 }}>✏️</span>
                    {d.name}
                  </div>
                  {/* small triangle pointer */}
                  <div style={{
                    width: 0, height: 0,
                    borderLeft: "6px solid transparent",
                    borderRight: "6px solid transparent",
                    borderTop: "6px solid rgba(10,14,22,0.88)",
                    marginLeft: 10,
                  }} />
                </div>
              ))}

              <canvas
                ref={canvasRef}
                width={3000}
                height={10000}
                className="whiteboard-canvas"
                style={{
                  cursor: tool === TOOLS.PAN ? "grab" : tool === TOOLS.ERASER ? "cell" : tool === TOOLS.LASER ? "crosshair" : "crosshair",
                  touchAction: "none",
                  display: "block"
                }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
              />

              {/* Real-time remote shape previews */}
              <svg style={{ position: "absolute", top: 0, left: 0, width: 3000, height: 10000, pointerEvents: "none", zIndex: 40 }}>
                {Object.entries(remotePreviews).map(([id, p]) => {
                  const x = p.start.x;
                  const y = p.start.y;
                  const w = p.end.x - x;
                  const h = p.end.y - y;
                  const color = p.color;
                  const stroke = p.stroke;

                  if (p.tool === TOOLS.RECTANGLE || p.tool === TOOLS.SQUARE) {
                    const side = p.tool === TOOLS.SQUARE ? Math.max(Math.abs(w), Math.abs(h)) : null;
                    const sw = side !== null ? (w < 0 ? -side : side) : w;
                    const sh = side !== null ? (h < 0 ? -side : side) : h;
                    return <rect key={id} x={sw < 0 ? x + sw : x} y={sh < 0 ? y + sh : y} width={Math.abs(sw)} height={Math.abs(sh)} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray="5,5" />;
                  }
                  if (p.tool === TOOLS.CIRCLE) {
                    const radius = Math.sqrt(w * w + h * h);
                    return <circle key={id} cx={x} cy={y} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray="5,5" />;
                  }
                  if (p.tool === TOOLS.LINE) {
                    return <line key={id} x1={x} y1={y} x2={p.end.x} y2={p.end.y} stroke={color} strokeWidth={stroke} strokeDasharray="5,5" />;
                  }
                  return null;
                })}
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* ── Session ended overlay ── */}
    {sessionEnded && (
      <div className="session-ended-overlay">
        <div className="session-ended-card">
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>🎓</div>
          <h2>Class Has Ended</h2>
          <p>
            {role === "teacher"
              ? "Your class session has ended and the board has been saved."
              : "The teacher ended this class session. Your work has been saved."}
          </p>
          <div className="session-ended-btns">
            <button className="se-btn primary" onClick={() => navigate(`/replay/${sessionCode}`)}>
              📋 View Session
            </button>
            <button className="se-btn secondary" onClick={() => navigate("/")}>
              ← Home
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Toast ── */}
    {toast && <div className="toast">{toast}</div>}
  </div>
);
}
