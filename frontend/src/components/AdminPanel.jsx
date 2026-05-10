// AdminPanel.jsx — Full admin control panel for skribblay.you
import React, { useState } from "react";
import "./AdminPanel.css";

function AdminPanel({ socket, allPlayers, currentWord }) {
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [log, setLog] = useState([]);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setLog((prev) => [`[${timestamp}] ${msg}`, ...prev].slice(0, 50));
  };

  // Listen for admin action confirmations
  React.useEffect(() => {
    if (!socket) return;

    socket.on("admin-action-log", ({ action }) => {
      addLog(action);
    });

    socket.on("admin-word-revealed", ({ word }) => {
      addLog(`Current word: "${word}"`);
    });

    return () => {
      socket.off("admin-action-log");
      socket.off("admin-word-revealed");
    };
  }, [socket]);

  if (!socket) return null;

  const kickPlayer = (targetId, name) => {
    socket.emit("admin-kick-player", { targetId });
    addLog(`Kicked ${name}`);
  };

  const mutePlayer = (targetId, name, muted) => {
    socket.emit("admin-mute-player", { targetId });
    addLog(`${muted ? "Unmuting" : "Muting"} ${name}...`);
  };

  const clearCanvas = () => {
    socket.emit("admin-clear-canvas");
    addLog("Canvas cleared");
  };

  const endTurn = () => {
    socket.emit("admin-end-turn");
    addLog("Turn ended");
  };

  const revealWord = () => {
    socket.emit("admin-reveal-word");
  };

  const stopGame = () => {
    socket.emit("admin-stop-game");
    addLog("Game stopped");
  };

  const broadcast = () => {
    if (!broadcastMsg.trim()) return;
    socket.emit("admin-broadcast", { message: broadcastMsg });
    addLog(`Broadcast: "${broadcastMsg}"`);
    setBroadcastMsg("");
  };

  return (
    <div className={`admin-panel ${isCollapsed ? "collapsed" : ""}`}>
      <div className="admin-panel-header" onClick={() => setIsCollapsed(!isCollapsed)}>
        <span>👑 Admin Panel</span>
        <span className="admin-panel-toggle">{isCollapsed ? "▲" : "▼"}</span>
      </div>

      {!isCollapsed && (
        <div className="admin-panel-body">
          {/* ── Game Controls ──────────────────────────── */}
          <section className="admin-section">
            <h3>🎮 Game Controls</h3>
            <div className="admin-btn-row">
              <button className="admin-btn danger" onClick={endTurn}>
                ⏭ End Turn
              </button>
              <button className="admin-btn warning" onClick={clearCanvas}>
                🗑 Clear Canvas
              </button>
              <button className="admin-btn info" onClick={revealWord}>
                👁 Reveal Word
              </button>
              <button className="admin-btn danger" onClick={stopGame}>
                🛑 Stop Game
              </button>
            </div>
          </section>

          {/* ── Broadcast ─────────────────────────────── */}
          <section className="admin-section">
            <h3>📢 Broadcast Message</h3>
            <div className="admin-broadcast-row">
              <input
                type="text"
                className="admin-input"
                placeholder="Type announcement..."
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && broadcast()}
              />
              <button className="admin-btn success" onClick={broadcast}>
                Send
              </button>
            </div>
          </section>

          {/* ── Player Management ─────────────────────── */}
          <section className="admin-section">
            <h3>👥 Players ({allPlayers.length})</h3>
            <div className="admin-players-list">
              {allPlayers.length === 0 && (
                <p className="admin-empty">No players connected</p>
              )}
              {allPlayers.map((pl) => (
                <div key={pl.id} className={`admin-player-row ${pl.isAdmin ? "is-admin" : ""}`}>
                  <img src={pl.avatar} alt={pl.name} className="admin-avatar" />
                  <div className="admin-player-info">
                    <span className="admin-player-name">
                      {pl.name}
                      {pl.isAdmin && <span className="admin-tag"> 👑</span>}
                      {pl.muted && <span className="muted-tag"> 🔇</span>}
                    </span>
                    <span className="admin-player-pts">{pl.points} pts</span>
                  </div>
                  {!pl.isAdmin && (
                    <div className="admin-player-actions">
                      <button
                        className={`admin-btn-sm ${pl.muted ? "success" : "warning"}`}
                        onClick={() => mutePlayer(pl.id, pl.name, pl.muted)}
                        title={pl.muted ? "Unmute" : "Mute"}
                      >
                        {pl.muted ? "🔊" : "🔇"}
                      </button>
                      <button
                        className="admin-btn-sm danger"
                        onClick={() => kickPlayer(pl.id, pl.name)}
                        title="Kick player"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── Action Log ────────────────────────────── */}
          <section className="admin-section">
            <h3>📋 Action Log</h3>
            <div className="admin-log">
              {log.length === 0 && <p className="admin-empty">No actions yet</p>}
              {log.map((entry, i) => (
                <div key={i} className="admin-log-entry">
                  {entry}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default AdminPanel;
