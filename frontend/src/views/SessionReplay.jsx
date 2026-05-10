// SessionReplay.jsx — View saved whiteboard snapshots from a past session
import React, { useEffect, useRef, useState } from "react";
import { useParams, useLocation, Link } from "react-router-dom";
import { jsPDF } from "jspdf";
import { API_BASE_URL } from "../config";
import "../App.css";

export default function SessionReplay() {
  const { code } = useParams();
  const location = useLocation();
  const canvasRef = useRef(null);

  const [session, setSession] = useState(location.state?.session || null);
  const [loading, setLoading] = useState(!location.state?.session);
  const [error, setError] = useState("");
  const [currentSnap, setCurrentSnap] = useState(0);

  // Load session if not passed via state
  useEffect(() => {
    if (session) return;
    fetch(`${API_BASE_URL}/api/sessions/${code}`)
      .then((r) => { if (!r.ok) throw new Error("Session not found"); return r.json(); })
      .then((data) => { setSession(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Draw snapshot onto canvas whenever selection changes
  useEffect(() => {
    if (!session || !canvasRef.current) return;
    const snaps = session.snapshots || [];
    if (snaps.length === 0) return;
    const snap = snaps[currentSnap];
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = snap.dataURL;
  }, [session, currentSnap]);

  const formatDate = (iso) =>
    iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

  const handleExportPDF = () => {
    if (!canvasRef.current || !session) return;
    const canvas = canvasRef.current;
    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? "l" : "p",
      unit: "px",
      format: [canvas.width, canvas.height]
    });
    pdf.addImage(imgData, "JPEG", 0, 0, canvas.width, canvas.height);
    pdf.save(`${session.title || "Jamboard_Session"}.pdf`);
  };

  if (loading) return (
    <div className="empty-state" style={{ height:"100vh" }}>
      <div className="icon">⏳</div><p>Loading session...</p>
    </div>
  );

  if (error) return (
    <div className="empty-state" style={{ height:"100vh" }}>
      <div className="icon">⚠️</div><p>{error}</p>
      <Link to="/history" className="back-btn">← Back to History</Link>
    </div>
  );

  const snaps = session?.snapshots || [];
  const chats = session?.chats || [];

  return (
    <div className="replay-screen">
      {/* Header */}
      <div className="replay-header">
        <Link to="/history" className="back-btn">← History</Link>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "4px" }}>
            <h2 style={{ fontFamily:"Space Grotesk, sans-serif", fontSize:"20px", margin: 0 }}>
              {session.title}
            </h2>
            <button
              onClick={handleExportPDF}
              className="home-btn primary"
              style={{ padding: "4px 10px", fontSize: "12px", background: "var(--success)" }}
            >
              📄 Export PDF
            </button>
          </div>
          <div style={{ display:"flex", gap:"12px", flexWrap:"wrap", fontSize:"13px", color:"var(--text2)" }}>
            <span>📌 Code: <strong style={{ color:"var(--primary)", letterSpacing:"2px" }}>{session.code}</strong></span>
            <span>👤 {session.createdBy}</span>
            <span>🕐 {formatDate(session.createdAt)}</span>
            {session.endedAt && <span>🏁 {formatDate(session.endedAt)}</span>}
            <span>
              <span className={`session-status ${session.active ? "active" : "ended"}`}>
                {session.active ? "● Live" : "✓ Ended"}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div style={{ display:"flex", gap:"20px", flex:1, minHeight:0, flexWrap:"wrap" }}>
        {/* Canvas replay */}
        <div className="replay-canvas-wrapper" style={{ flex:2, minWidth:"320px" }}>
          {snaps.length === 0 ? (
            <div className="empty-state" style={{ padding:"48px" }}>
              <div className="icon">📋</div>
              <p>No snapshots were saved for this session.</p>
            </div>
          ) : (
            <>
              <canvas
                ref={canvasRef}
                width={1200}
                height={5000}
                style={{
                  width:"100%", maxWidth:"900px",
                  height:"auto",
                  background:"#fff",
                  borderRadius:"8px",
                  boxShadow:"0 4px 24px rgba(0,0,0,0.3)",
                  display:"block",
                }}
              />

              <div className="replay-controls">
                <button
                  className="replay-btn"
                  onClick={() => setCurrentSnap((p) => Math.max(0, p - 1))}
                  disabled={currentSnap === 0}
                >
                  ← Prev
                </button>
                <span className="replay-snapshot-count">
                  Snapshot {currentSnap + 1} of {snaps.length}
                  <span style={{ marginLeft:"8px", color:"var(--text3)", fontSize:"11px" }}>
                    {formatDate(snaps[currentSnap]?.timestamp)}
                    {snaps[currentSnap]?.isFinal ? " (Final)" : ""}
                  </span>
                </span>
                <button
                  className="replay-btn"
                  onClick={() => setCurrentSnap((p) => Math.min(snaps.length - 1, p + 1))}
                  disabled={currentSnap === snaps.length - 1}
                >
                  Next →
                </button>
              </div>

              {/* Snapshot thumbnails */}
              <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", justifyContent:"center", maxWidth:"900px" }}>
                {snaps.map((s, i) => (
                  <button
                    key={i}
                    className={`replay-btn ${currentSnap === i ? "active" : ""}`}
                    style={{ padding:"4px 10px", fontSize:"11px" }}
                    onClick={() => setCurrentSnap(i)}
                  >
                    {i + 1}{s.isFinal ? " ★" : ""}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Chat log + participants */}
        <div style={{ width:"260px", flexShrink:0, display:"flex", flexDirection:"column", gap:"16px" }}>
          {/* Participants */}
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:"12px", padding:"16px" }}>
            <h3 style={{ fontSize:"12px", fontWeight:700, textTransform:"uppercase", letterSpacing:"1px", color:"var(--text3)", marginBottom:"12px" }}>
              Participants ({(session.participants || []).length})
            </h3>
            {(session.participants || []).map((p, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"8px" }}>
                <div className={`participant-avatar ${p.role}`} style={{ width:"28px", height:"28px", fontSize:"12px" }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize:"13px", fontWeight:500 }}>{p.name}</div>
                  <div style={{ fontSize:"11px", color:"var(--text3)", textTransform:"capitalize" }}>{p.role}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Chat log */}
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:"12px", padding:"16px", flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
            <h3 style={{ fontSize:"12px", fontWeight:700, textTransform:"uppercase", letterSpacing:"1px", color:"var(--text3)", marginBottom:"12px" }}>
              Chat Log ({chats.length})
            </h3>
            <div style={{ overflowY:"auto", flex:1, display:"flex", flexDirection:"column", gap:"8px" }}>
              {chats.length === 0 && (
                <div className="empty-state" style={{ padding:"24px 0" }}>
                  <p>No messages</p>
                </div>
              )}
              {chats.filter(c => c.role !== "system").map((c, i) => (
                <div key={i} className={`chat-msg ${c.role === "teacher" ? "teacher-msg" : "student-msg"}`}>
                  <div className={`chat-sender ${c.role}`}>{c.sender}</div>
                  {c.message}
                  <div style={{ fontSize:"10px", color:"var(--text3)", marginTop:"3px" }}>
                    {c.timestamp ? new Date(c.timestamp).toLocaleTimeString() : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
