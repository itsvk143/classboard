// ClassroomScreen.jsx — Main real-time collaborative whiteboard
import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  MousePointer2, Move, PenTool, Highlighter, Eraser, Circle, Square,
  Triangle, Hexagon, Minus, Zap, Trash2, FileDown, Save, LogOut,
  ChevronDown, ChevronUp, Crown, User, Menu, Copy, Maximize, ArrowLeft,
  FilePlus2, ImagePlus
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
const TOOLS = { SELECT: "select", LASSO: "lasso", PEN: "pen", ERASER: "eraser", HIGHLIGHTER: "highlighter", LASER: "laser", LINE: "line", TRIANGLE: "triangle", CIRCLE: "circle", RECTANGLE: "rectangle", SQUARE: "square", HEXAGON: "hexagon" };

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
  const { action, name, email, sessionTitle, code: joinCode, isTeacher } = state;

  const sessionCodeRef = useRef(joinCode || "");

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
  const startPos = useRef(null);
  const snapshotRef = useRef(null); // for straight line preview
  const [lasers, setLasers] = useState({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isSidebarOpenRef = useRef(isSidebarOpen);
  const [zoom, setZoom] = useState(1.0); // 1.0 = 100%
  const [showMoreShapes, setShowMoreShapes] = useState(false);
  const [shapeMenuCoords, setShapeMenuCoords] = useState({ top: 0, left: 0 });

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
      showToast(`Session created! Code: ${code}`);
    });

    sock.on("session-joined", ({ code, room, canvasState, chats: prevChats, role: r }) => {
      setSessionCode(code);
      setSessionInfo(room);
      setMembers(room.members || []);
      setRole(r);
      setChats(prevChats || []);
      if (canvasState) loadCanvasFromDataURL(canvasState);
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

    sock.on("snapshot-saved", ({ timestamp }) => {
      setSnapshotSaved(new Date(timestamp).toLocaleTimeString());
      setTimeout(() => setSnapshotSaved(null), 3000);
    });

    sock.on("error-msg", ({ msg }) => showToast("⚠️ " + msg));

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

  const getPos = (e) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      return {
        x: (e.touches[0].clientX - rect.left) / zoom,
        y: (e.touches[0].clientY - rect.top) / zoom,
      };
    }
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom
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

  const onDown = (e) => {
    if (e.button === 2) return; // ignore right-click
    e.preventDefault();
    const pos = getPos(e);

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
      ctxRef.current.beginPath();
      ctxRef.current.moveTo(pos.x, pos.y);
    }
  };

  const onMove = (e) => {
    e.preventDefault();
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
      ctxRef.current.strokeStyle = color;
      ctxRef.current.lineWidth = stroke;
      ctxRef.current.globalAlpha = tool === TOOLS.HIGHLIGHTER ? 0.3 : 1.0;

      // Smoothing with Quadratic Curves for a premium feel
      const midPoint = { x: (lastPos.current.x + pos.x) / 2, y: (lastPos.current.y + pos.y) / 2 };
      ctxRef.current.quadraticCurveTo(lastPos.current.x, lastPos.current.y, midPoint.x, midPoint.y);
      ctxRef.current.stroke();
      ctxRef.current.globalAlpha = 1.0;

      emitStroke(lastPos.current.x, lastPos.current.y, pos.x, pos.y, tool);
    } else if (tool === TOOLS.ERASER) {
      ctxRef.current.strokeStyle = "#ffffff";
      ctxRef.current.lineWidth = stroke * 4;
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
  };

  const onUp = (e) => {
    if (!isPainting.current && !isDraggingSelection.current && !isResizingSelection.current && !isRotatingSelection.current) return;
    const pos = getPos(e);

    if (isDraggingSelection.current || isResizingSelection.current || isRotatingSelection.current) {
      isDraggingSelection.current = false;
      isResizingSelection.current = false;
      isRotatingSelection.current = false;
      if (liveSelectionRef.current) {
        setSelection({ ...liveSelectionRef.current });
      }
      emitCanvas();
      return;
    }

    isPainting.current = false;

    if (tool === TOOLS.LASER) {
      if (socket) socket.emit("laser-stop", { code: sessionCode });
      return;
    }

    if (isShapeTool(tool)) {
      ctxRef.current.putImageData(snapshotRef.current, 0, 0);
      drawShape(ctxRef.current, tool, startPos.current, pos, color, stroke);

      // Sync the shape completion
      if (socket) {
        socket.emit("draw-shape", {
          code: sessionCode,
          tool,
          start: startPos.current,
          end: pos,
          color,
          stroke,
          isPreview: false
        });
      }
    } else if (isSelectionTool(tool)) {
      const w = Math.abs(pos.x - startPos.current.x);
      const h = Math.abs(pos.y - startPos.current.y);
      const x = Math.min(pos.x, startPos.current.x);
      const y = Math.min(pos.y, startPos.current.y);
      if (liveSelectionRef.current) {
        setSelection({ ...liveSelectionRef.current });
      }
    } else if (isPainting.current) {
      isPainting.current = false;
      ctxRef.current.putImageData(snapshotRef.current, 0, 0);

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
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const w = maxX - minX;
          const h = maxY - minY;

          if (w > 5 && h > 5) {
            const originalData = ctxRef.current.getImageData(minX, minY, w, h);

            const offCanvas = document.createElement("canvas");
            offCanvas.width = w;
            offCanvas.height = h;
            const offCtx = offCanvas.getContext("2d");

            offCtx.beginPath();
            lassoPath.current.forEach((p, i) => {
              if (i === 0) offCtx.moveTo(p.x - minX, p.y - minY);
              else offCtx.lineTo(p.x - minX, p.y - minY);
            });
            offCtx.closePath();
            offCtx.clip();

            const srcCanvas = document.createElement("canvas");
            srcCanvas.width = w;
            srcCanvas.height = h;
            srcCanvas.getContext("2d").putImageData(originalData, 0, 0);

            offCtx.drawImage(srcCanvas, 0, 0);
            const maskedData = offCtx.getImageData(0, 0, w, h);

            setSelection({ type: TOOLS.LASSO, x: minX, y: minY, w, h, imgData: maskedData, isCut: false, path: [...lassoPath.current] });
          }
        }
      }
    }
    return;

  if (!isPainting.current) return;
  isPainting.current = false;

  if (tool === TOOLS.LASER) {
    if (socket) socket.emit("laser-stop", { code: sessionCode });
    return;
  }

  if (isShapeTool(tool)) {
    const pos = getPos(e);
    ctxRef.current.putImageData(snapshotRef.current, 0, 0);
    drawShape(ctxRef.current, tool, startPos.current, pos, color, stroke);

    if (tool === TOOLS.LINE) {
      emitStroke(startPos.current.x, startPos.current.y, pos.x, pos.y, tool);
    }
  }

  emitCanvas();
  ctxRef.current.beginPath();
  snapshotRef.current = null;
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
  const dataURL = getWhiteBackgroundDataURL(canvasRef.current, 0.85, liveSelectionRef.current);
  socket.emit("save-snapshot", { sessionCode, dataURL, isFinal: false });
  alert("Snapshot saved to session history.");
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
  const finalDataURL = getWhiteBackgroundDataURL(canvasRef.current, 0.85, liveSelectionRef.current);
  socket.emit("end-session", { code: sessionCode, finalDataURL });
};

const handleKick = (targetId) => {
  if (!socket) return;
  socket.emit("kick-member", { code: sessionCode, targetId });
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

return (
  <div className="classroom">
    {/* ── Header ── */}
    <header className="classroom-header">
      <div className="classroom-title-area">
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          style={{ background: "transparent", border: "none", color: "var(--text1)", fontSize: "24px", cursor: "pointer", marginRight: "12px", position: "relative", display: "flex", alignItems: "center" }}
          title="Toggle Chat & Participants"
        >
          <Menu size={24} />
          {unreadCount > 0 && (
            <span style={{ position: "absolute", top: "-5px", right: "-10px", background: "#ef4444", color: "#fff", fontSize: "10px", padding: "2px 5px", borderRadius: "10px", fontWeight: "bold" }}>
              {unreadCount}
            </span>
          )}
        </button>
        <div className="toolbar" style={{ margin: 0, padding: 0, background: "transparent", border: "none", boxShadow: "none" }}>
          <div className="toolbar-group">
            {[
              { id: TOOLS.SELECT, label: <MousePointer2 size={18} />, title: "Select" },
              { id: TOOLS.LASSO, label: <Move size={18} />, title: "Lasso Select" },
              { id: TOOLS.PEN, label: <PenTool size={18} />, title: "Pen" },
              { id: TOOLS.HIGHLIGHTER, label: <Highlighter size={18} />, title: "Highlighter" },
              { id: TOOLS.ERASER, label: <Eraser size={18} />, title: "Eraser" },
              { id: TOOLS.CIRCLE, label: <Circle size={18} />, title: "Circle" },
              { id: TOOLS.RECTANGLE, label: <Square size={18} />, title: "Rectangle" }
            ].map((t) => (
              <React.Fragment key={t.id}>
                <button
                  className={`tool-btn ${tool === t.id ? "active" : ""}`}
                  title={t.title}
                  onClick={() => setTool(t.id)}
                >
                  {t.label}
                </button>
                {t.id === TOOLS.ERASER && role === "teacher" && (
                  <button
                    className="tool-btn"
                    onClick={handleClearCanvas}
                    title="Clear Board"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </React.Fragment>
            ))}

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
                <div style={{
                  position: "fixed",
                  top: shapeMenuCoords.top,
                  left: shapeMenuCoords.left,
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  background: "var(--bg2)",
                  padding: "6px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  zIndex: 9999,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.6)"
                }}>
                  {[
                    { id: TOOLS.LINE, label: <Minus size={18} />, title: "Straight line" },
                    { id: TOOLS.SQUARE, label: <Square size={18} />, title: "Square" },
                    { id: TOOLS.TRIANGLE, label: <Triangle size={18} />, title: "Triangle" },
                    { id: TOOLS.HEXAGON, label: <Hexagon size={18} />, title: "Hexagon" }
                  ].map(t => (
                    <button
                      key={t.id}
                      className={`tool-btn ${tool === t.id ? "active" : ""}`}
                      title={t.title}
                      onClick={() => { setTool(t.id); setShowMoreShapes(false); }}
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>

            {[
              { id: TOOLS.LASER, label: <Zap size={18} />, title: "Laser Pointer" },
            ].map((t) => (
              <React.Fragment key={t.id}>
                <button
                  className={`tool-btn ${tool === t.id ? "active" : ""}`}
                  title={t.title}
                  onClick={() => setTool(t.id)}
                >
                  {t.label}
                </button>
              </React.Fragment>
            ))}
            <div className="toolbar-divider" />

            <button
              className="tool-btn"
              title="Insert Image"
              onClick={() => document.getElementById("canvas-image-upload").click()}
            >
              <ImagePlus size={18} />
            </button>
            <input
              id="canvas-image-upload"
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />

            <button
              className="tool-btn"
              title="Insert PDF"
              onClick={() => document.getElementById("canvas-pdf-upload").click()}
            >
              <FilePlus2 size={18} />
            </button>
            <input
              id="canvas-pdf-upload"
              type="file"
              accept="application/pdf"
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />
          </div>

          <div className="toolbar-divider" />

          <div className="color-dot">
            {COLORS.map((c) => (
              <div
                key={c}
                className={`color-swatch ${color === c ? "active" : ""}`}
                style={{ background: c, border: c === "#ffffff" ? "2px solid #555" : "2px solid transparent" }}
                onClick={() => { setColor(c); setTool(TOOLS.PEN); }}
                title={c}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => { setColor(e.target.value); setTool(TOOLS.PEN); }}
              style={{ width: "22px", height: "22px", border: "none", background: "transparent", cursor: "pointer", borderRadius: "50%", overflow: "hidden" }}
              title="Custom color"
            />
          </div>

          <div className="toolbar-divider" />
          <span style={{ fontSize: "11px", color: "var(--text3)", fontWeight: "600", textTransform: "uppercase" }}>Size</span>
          <input
            className="stroke-slider"
            type="range"
            min={1}
            max={30}
            value={stroke}
            onChange={(e) => setStroke(parseInt(e.target.value))}
          />
        </div>

        {/* Role and Code moved to Sidebar */}
      </div>

      <div className="classroom-header-btns">
        {snapshotSaved && (
          <span style={{ fontSize: "12px", color: "#4ade80" }}>✓ Saved {snapshotSaved}</span>
        )}
        <button className="hdr-btn" onClick={() => {
          const elem = document.documentElement;
          const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
          if (!isFullscreen) {
            if (elem.requestFullscreen) {
              elem.requestFullscreen().catch(err => alert(`Fullscreen error: ${err.message}`));
            } else if (elem.webkitRequestFullscreen) {
              elem.webkitRequestFullscreen();
            } else if (elem.mozRequestFullScreen) {
              elem.mozRequestFullScreen();
            } else if (elem.msRequestFullscreen) {
              elem.msRequestFullscreen();
            }
          } else {
            if (document.exitFullscreen) {
              document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
              document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
              document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
              document.msExitFullscreen();
            }
          }
        }}>
          <Maximize size={18} />
        </button>

        <div className="zoom-controls" style={{ display: "flex", alignItems: "center", background: "var(--bg3)", borderRadius: "8px", padding: "2px 8px", border: "1px solid var(--border)", gap: "8px" }}>
          <button className="zoom-btn" onClick={() => setZoom(Math.max(0.01, zoom - 0.1))} style={{ background: "transparent", border: "none", color: "var(--text2)", cursor: "pointer", fontSize: "18px" }}>-</button>
          <span style={{ fontSize: "12px", color: "var(--text)", minWidth: "45px", textAlign: "center", fontWeight: "bold" }}>{Math.round(zoom * 100)}%</span>
          <button className="zoom-btn" onClick={() => setZoom(Math.min(10.0, zoom + 0.1))} style={{ background: "transparent", border: "none", color: "var(--text2)", cursor: "pointer", fontSize: "18px" }}>+</button>
          <button
            className="zoom-btn"
            onClick={() => setZoom(1.0)}
            style={{ background: "rgba(79,142,247,0.1)", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "10px", padding: "4px 8px", borderRadius: "4px" }}
          >
            Reset
          </button>
        </div>

        <button className="hdr-btn save" onClick={handleExportPDF} title="Export PDF">
          <FileDown size={18} />
        </button>
        <button className="hdr-btn save" onClick={handleSaveSnapshot} title="Save Snapshot">
          <Save size={18} />
        </button>
        {role === "teacher" && (
          <button className="hdr-btn end" onClick={handleEndSession} title="End Class">
            <LogOut size={18} />
          </button>
        )}
        <button
          className="hdr-btn"
          style={{ background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text2)", padding: "8px 12px" }}
          onClick={() => navigate("/")}
          title="Leave Session"
        >
          <ArrowLeft size={18} />
        </button>
      </div>
    </header>

    <div className="classroom-body">
      {/* ── Sidebar ── */}
      {isSidebarOpen && (
        <aside className="classroom-sidebar">
          <div className="sidebar-section" style={{ borderBottom: "1px solid var(--border)", padding: "16px 12px", display: "flex", alignItems: "center", gap: "10px", background: "rgba(255,255,255,0.03)" }}>
            <span className={`classroom-role-pill ${role}`} style={{ margin: 0 }}>
              {role === "teacher" ? <Crown size={16} /> : <User size={16} />}
              <span style={{ marginLeft: "6px", fontSize: "12px", fontWeight: "600" }}>{role === "teacher" ? "Teacher" : "Student"}</span>
            </span>
            {sessionCode && (
              <span className="classroom-code-badge" onClick={copyCode} style={{ margin: 0, padding: "4px 8px" }}>
                <Copy size={14} /> {sessionCode}
              </span>
            )}
          </div>
          <div className="sidebar-section">
            <h3>Participants ({members.length})</h3>
            {members.map((m) => (
              <div className="participant-item" key={m.id}>
                <div className={`participant-avatar ${m.role}`}>
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <div className="participant-info">
                  <div className="participant-name">{m.name} {m.id === socket?.id ? "(you)" : ""}</div>
                  <div className="participant-role">{m.role}</div>
                </div>
                {role === "teacher" && m.role !== "teacher" && (
                  <button className="kick-btn" onClick={() => handleKick(m.id)} title="Remove from class">✕</button>
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
        <div className="canvas-wrapper">
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
              <canvas
                ref={canvasRef}
                width={3000}
                height={10000}
                className="whiteboard-canvas"
                style={{
                  cursor: tool === TOOLS.ERASER ? "cell" : tool === TOOLS.LASER ? "crosshair" : "crosshair",
                  touchAction: "none",
                  display: "block"
                }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerLeave={onUp}
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
