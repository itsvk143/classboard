// SessionHistory.jsx — View all past and active class sessions
import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import "../App.css";

export default function SessionHistory() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("http://localhost:3001/api/sessions")
      .then((r) => {
        if (!r.ok) throw new Error("Could not load sessions");
        return r.json();
      })
      .then((data) => { setSessions(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  const formatDate = (iso) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  };

  const duration = (s) => {
    if (!s.createdAt || !s.endedAt) return "—";
    const ms = new Date(s.endedAt) - new Date(s.createdAt);
    const m = Math.floor(ms / 60000);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  return (
    <div className="history-screen">
      <div className="history-header" style={{ maxWidth:"1200px", margin:"0 auto 32px" }}>
        <Link to="/" className="back-btn">← Back</Link>
        <h1>📋 Session History</h1>
      </div>

      {loading && (
        <div className="empty-state">
          <div className="icon">⏳</div>
          <p>Loading sessions...</p>
        </div>
      )}

      {error && (
        <div className="empty-state">
          <div className="icon">⚠️</div>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className="empty-state">
          <div className="icon">🎓</div>
          <p>No class sessions yet. Create one to get started!</p>
          <Link to="/" className="back-btn" style={{ marginTop:"12px" }}>→ Create a Session</Link>
        </div>
      )}

      <div className="history-grid">
        {sessions.map((s) => (
          <div
            key={s.code}
            className="session-card"
            onClick={() => navigate(`/replay/${s.code}`)}
          >
            <div className="session-card-header">
              <div className="session-card-title">{s.title}</div>
              <div className="session-card-code">{s.code}</div>
            </div>

            <div className="session-card-meta">
              <div className="session-meta-row">
                <span>
                  <span className={`session-status ${s.active ? "active" : "ended"}`}>
                    {s.active ? "● Live" : "✓ Ended"}
                  </span>
                </span>
              </div>
              <div className="session-meta-row">
                👤 {s.createdBy}
              </div>
              <div className="session-meta-row">
                🕐 {formatDate(s.createdAt)}
              </div>
              <div className="session-meta-row">
                ⏱ Duration: {duration(s)}
              </div>
              <div className="session-meta-row">
                👥 {s.participantCount} participant{s.participantCount !== 1 ? "s" : ""}
                &nbsp;&nbsp;
                📸 {s.snapshotCount} snapshot{s.snapshotCount !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
