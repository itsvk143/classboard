// HomeScreen.jsx — Classroom entry: create or join a session
import React, { useState, useEffect } from "react";
import "../App.css";
import { useNavigate } from "react-router-dom";

const HomeScreen = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState("join");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [folders, setFolders] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState({});

  // Multi-select state (works on all folders, especially Unorganized)
  const [selectedSessions, setSelectedSessions] = useState(new Set());

  // Modal State for folder management
  const [modalState, setModalState] = useState(null);
  const [modalInput, setModalInput] = useState("");

  const loadData = () => {
    fetch("http://localhost:3001/api/sessions")
      .then((r) => r.json())
      .then((data) => { setSessions(data); setLoadingSessions(false); })
      .catch((e) => { console.error(e); setLoadingSessions(false); });

    fetch("http://localhost:3001/api/folders")
      .then(r => r.json())
      .then(data => setFolders(data))
      .catch(e => console.error(e));
  };

  useEffect(() => { loadData(); }, []);

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

  // ── Delete handlers ────────────────────────────────────────────────────────
  const deleteSession = (sessionCode, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm(`Delete session "${sessionCode}"? This cannot be undone.`)) return;
    fetch(`http://localhost:3001/api/sessions/${sessionCode}`, { method: "DELETE" })
      .then(() => {
        setSelectedSessions(prev => { const n = new Set(prev); n.delete(sessionCode); return n; });
        loadData();
      });
  };

  const bulkDelete = (codes) => {
    if (codes.length === 0) return;
    if (!window.confirm(`Delete ${codes.length} session(s)? This cannot be undone.`)) return;
    fetch("http://localhost:3001/api/sessions/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes })
    }).then(() => {
      setSelectedSessions(new Set());
      loadData();
    });
  };

  const handleToggleSelect = (sessionCode, e) => {
    e.stopPropagation();
    setSelectedSessions(prev => {
      const n = new Set(prev);
      if (n.has(sessionCode)) n.delete(sessionCode); else n.add(sessionCode);
      return n;
    });
  };

  const handleSelectAll = (sessionCodes) => {
    const allSelected = sessionCodes.length > 0 && sessionCodes.every(c => selectedSessions.has(c));
    setSelectedSessions(prev => {
      const n = new Set(prev);
      if (allSelected) {
        sessionCodes.forEach(c => n.delete(c));
      } else {
        sessionCodes.forEach(c => n.add(c));
      }
      return n;
    });
  };

  // ── Folder handlers ────────────────────────────────────────────────────────
  const handleMoveToFolder = (sessionCode, currentFolder) => {
    setModalInput(currentFolder || "");
    setModalState({ type: "MOVE_SESSION", code: sessionCode });
  };

  const handleCreateFolder = (e) => {
    if (e) e.preventDefault();
    setModalInput("");
    setModalState({ type: "CREATE_FOLDER" });
  };

  const handleRenameFolder = (id, currentName, e) => {
    if (e) e.preventDefault();
    setModalInput(currentName);
    setModalState({ type: "RENAME_FOLDER", id, currentName });
  };

  const handleDeleteFolder = (id, e) => {
    if (e) e.preventDefault();
    if (!window.confirm("Delete this folder? Sessions inside will be unorganized.")) return;
    fetch(`http://localhost:3001/api/folders/${id}`, { method: "DELETE" }).then(() => loadData());
  };

  const handleModalSubmit = () => {
    if (!modalState) return;
    const { type } = modalState;
    const val = modalInput.trim();

    if (type === "CREATE_FOLDER") {
      if (!val) { setModalState(null); return; }
      fetch("http://localhost:3001/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: val })
      }).then(() => { loadData(); setModalState(null); });
    } else if (type === "RENAME_FOLDER") {
      const { id, currentName } = modalState;
      if (!val || val === currentName) { setModalState(null); return; }
      fetch(`http://localhost:3001/api/folders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: val })
      }).then(() => { loadData(); setModalState(null); });
    } else if (type === "MOVE_SESSION") {
      const { code: sessionCode } = modalState;
      const doMove = () => {
        fetch(`http://localhost:3001/api/sessions/${sessionCode}/folder`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: val })
        }).then(() => { loadData(); setModalState(null); });
      };
      if (val !== "" && !folders.find(f => f.name === val)) {
        fetch("http://localhost:3001/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: val })
        }).then(doMove);
      } else {
        doMove();
      }
    }
  };

  const groupedSessions = sessions.reduce((acc, s) => {
    const f = s.folder || "Unorganized";
    if (!acc[f]) acc[f] = [];
    acc[f].push(s);
    return acc;
  }, {});

  folders.forEach(f => {
    if (!groupedSessions[f.name]) groupedSessions[f.name] = [];
  });

  const toggleFolder = (folderName) => {
    setExpandedFolders(prev => ({ ...prev, [folderName]: !prev[folderName] }));
  };

  const handleCreate = () => {
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (!sessionTitle.trim()) { setError("Please enter a class title."); return; }
    setError("");
    navigate("/classroom", { state: { action: "create", name, email, sessionTitle, isTeacher: true } });
  };

  const handleJoin = () => {
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (!code.trim()) { setError("Please enter a session code."); return; }
    setError("");
    navigate("/classroom", { state: { action: "join", name, email, code: code.toUpperCase(), isTeacher: false } });
  };

  return (
    <div className="home-screen">
      <div className="home-logo" style={{ marginBottom: "16px" }}>
        <span className="home-logo-icon">🖊️</span>
        <h1>ClassBoard</h1>
      </div>
      <p className="home-tagline">Real-time collaborative whiteboard for online classes</p>

      <div className="home-split-layout">
        {/* LEFT: Past Sessions */}
        <div className="home-left-panel">
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px" }}>
            <h2 style={{ color: "var(--text)", fontSize: "20px", margin: 0 }}>📋 Past Sessions</h2>
            <button
              type="button"
              onClick={handleCreateFolder}
              style={{ background: "var(--primary)", border: "none", borderRadius: "50%", width: "28px", height: "28px", color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}
              title="New Folder"
            >+</button>
          </div>

          {loadingSessions ? (
            <p style={{ color: "var(--text3)" }}>Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <div className="empty-state" style={{ padding: "30px", background: "var(--bg2)", borderRadius: "var(--radius-lg)" }}>
              <div className="icon" style={{ fontSize: "32px", marginBottom: "10px" }}>🎓</div>
              <p>No class sessions yet. Create one to get started!</p>
            </div>
          ) : (
            <div className="home-history-list">
              {Object.keys(groupedSessions)
                .sort((a, b) => a === "Unorganized" ? 1 : b === "Unorganized" ? -1 : a.localeCompare(b))
                .map(folderName => {
                  const folderObj = folders.find(f => f.name === folderName);
                  const isExpanded = expandedFolders[folderName];
                  const isUnorganized = folderName === "Unorganized";
                  const folderCodes = groupedSessions[folderName].map(s => s.code);
                  const selectedInFolder = folderCodes.filter(c => selectedSessions.has(c));
                  const allSelected = folderCodes.length > 0 && selectedInFolder.length === folderCodes.length;

                  return (
                    <div
                      key={folderName}
                      style={{
                        background: "var(--bg2)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-lg)",
                        padding: "16px",
                        gridColumn: isExpanded ? "1 / -1" : "auto",
                        cursor: isExpanded ? "default" : "pointer",
                        transition: "all 0.2s"
                      }}
                      onClick={() => { if (!isExpanded) toggleFolder(folderName); }}
                    >
                      {/* ── Folder Header ─────────────────────────────── */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: isExpanded ? "1px solid var(--border)" : "none", paddingBottom: isExpanded ? "12px" : "0", marginBottom: isExpanded ? "16px" : "0", gap: "8px" }}>
                        <h3
                          onClick={(e) => { e.stopPropagation(); toggleFolder(folderName); }}
                          style={{ fontSize: "16px", color: "var(--text)", display: "flex", alignItems: "center", gap: "8px", margin: 0, cursor: "pointer", flex: 1 }}
                        >
                          <span style={{ color: "var(--primary)" }}>{isExpanded ? "📂" : "📁"}</span>
                          {folderName}
                          {!isExpanded && <span style={{ fontSize: "12px", color: "var(--text3)", fontWeight: "normal" }}>({folderCodes.length})</span>}
                        </h3>

                        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                          {/* Unorganized: Select All + bulk delete buttons */}
                          {isUnorganized && isExpanded && folderCodes.length > 0 && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleSelectAll(folderCodes)}
                                style={{ background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text2)", cursor: "pointer", fontSize: "11px", padding: "4px 8px", borderRadius: "4px", whiteSpace: "nowrap" }}
                              >
                                {allSelected ? "✓ Deselect All" : "☐ Select All"}
                              </button>

                              {selectedInFolder.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => bulkDelete(selectedInFolder)}
                                  style={{ background: "rgba(239,68,68,0.15)", border: "1px solid var(--danger)", color: "var(--danger)", cursor: "pointer", fontSize: "11px", padding: "4px 8px", borderRadius: "4px", whiteSpace: "nowrap", fontWeight: 600 }}
                                >
                                  🗑 Delete {selectedInFolder.length}
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => bulkDelete(folderCodes)}
                                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.4)", color: "var(--danger)", cursor: "pointer", fontSize: "11px", padding: "4px 8px", borderRadius: "4px", whiteSpace: "nowrap" }}
                              >
                                🗑 All
                              </button>
                            </>
                          )}

                          {folderObj && (
                            <>
                              <button
                                type="button"
                                onClick={(e) => handleRenameFolder(folderObj.id, folderObj.name, e)}
                                style={{ background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text2)", cursor: "pointer", fontSize: "12px", padding: "4px 8px", borderRadius: "4px" }}
                              >✏️</button>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteFolder(folderObj.id, e)}
                                style={{ background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--danger)", cursor: "pointer", fontSize: "12px", padding: "4px 8px", borderRadius: "4px" }}
                              >🗑️</button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => toggleFolder(folderName)}
                            style={{ background: "transparent", border: "none", color: "var(--text2)", cursor: "pointer", fontSize: "12px", padding: 0 }}
                          >
                            {isExpanded ? "▲" : "▼"}
                          </button>
                        </div>
                      </div>

                      {/* ── Folder Contents ───────────────────────────── */}
                      {isExpanded && (
                        groupedSessions[folderName].length === 0 ? (
                          <p style={{ color: "var(--text3)", fontSize: "14px", fontStyle: "italic", textAlign: "center", padding: "20px 0" }}>Empty folder</p>
                        ) : (
                          <div className="home-history-list">
                            {groupedSessions[folderName].map((s) => {
                              const isSelected = selectedSessions.has(s.code);
                              return (
                                <div
                                  key={s.code}
                                  className="session-card"
                                  style={{
                                    cursor: "pointer",
                                    padding: "12px",
                                    background: isSelected ? "rgba(59,130,246,0.08)" : "var(--bg)",
                                    border: isSelected ? "1px solid var(--primary)" : "1px solid var(--border)",
                                    borderRadius: "var(--radius)",
                                    position: "relative",
                                    transition: "border 0.15s, background 0.15s"
                                  }}
                                >
                                  {/* Checkbox — always show in Unorganized */}
                                  {isUnorganized && (
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={(e) => handleToggleSelect(s.code, e)}
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ position: "absolute", top: "12px", left: "10px", width: "15px", height: "15px", cursor: "pointer", accentColor: "var(--primary)" }}
                                    />
                                  )}

                                  <div
                                    onClick={() => navigate(`/replay/${s.code}`)}
                                    style={{ paddingLeft: isUnorganized ? "26px" : "0" }}
                                  >
                                    <div className="session-card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                                      <div className="session-card-title" style={{ fontWeight: "600", fontSize: "14px", flex: 1, paddingRight: "8px" }}>{s.title}</div>
                                      <div style={{ display: "flex", gap: "5px", alignItems: "center", flexShrink: 0 }}>
                                        <div style={{ fontFamily: "monospace", color: "var(--text2)", background: "var(--bg3)", padding: "2px 6px", borderRadius: "4px", fontSize: "12px" }}>{s.code}</div>
                                        <button
                                          type="button"
                                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleMoveToFolder(s.code, s.folder); }}
                                          style={{ background: "var(--bg3)", border: "1px solid var(--border)", cursor: "pointer", fontSize: "11px", padding: "3px 6px", borderRadius: "4px", color: "var(--text)" }}
                                          title="Move to folder"
                                        >📂</button>
                                        <button
                                          type="button"
                                          onClick={(e) => deleteSession(s.code, e)}
                                          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", cursor: "pointer", fontSize: "11px", padding: "3px 6px", borderRadius: "4px", color: "var(--danger)" }}
                                          title="Delete session"
                                        >🗑</button>
                                      </div>
                                    </div>
                                    <div className="session-card-meta" style={{ fontSize: "12px", color: "var(--text2)", display: "flex", flexDirection: "column", gap: "2px" }}>
                                      <div>
                                        <span style={{ color: s.active ? "var(--success)" : "var(--text3)", fontWeight: "500" }}>
                                          {s.active ? "● Live" : "✓ Ended"}
                                        </span>
                                      </div>
                                      <div>👤 {s.createdBy}</div>
                                      <div>🕐 {formatDate(s.createdAt)}</div>
                                      <div>⏱ Duration: {duration(s)}</div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* RIGHT: Join/Create Form */}
        <div className="home-right-panel">
          <div className="home-card">
            <div className="home-tab-row">
              <button className={`home-tab ${tab === "join" ? "active" : ""}`} onClick={() => { setTab("join"); setError(""); }}>
                Join Class
              </button>
              <button className={`home-tab ${tab === "create" ? "active" : ""}`} onClick={() => { setTab("create"); setError(""); }}>
                Create Class
              </button>
            </div>

            <div className="home-field">
              <label>Your Name</label>
              <input className="home-input" placeholder="Enter your name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="home-field">
              <label>Email <span style={{ color: "var(--text3)" }}>(optional)</span></label>
              <input className="home-input" type="email" placeholder="your@email.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} />
            </div>

            {tab === "create" && (
              <>
                <div className="home-field">
                  <label>Class Title</label>
                  <input className="home-input" placeholder="e.g. Physics – Chapter 3" value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} />
                </div>
                {error && <div className="home-error">{error}</div>}
                <button className="home-btn teacher" onClick={handleCreate}>⚡ Create Class Session</button>
              </>
            )}

            {tab === "join" && (
              <>
                <div className="home-field">
                  <label>Session Code</label>
                  <input
                    className="home-input"
                    placeholder="e.g. AB12CD"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    style={{ letterSpacing: "3px", fontWeight: "700", fontSize: "16px" }}
                    maxLength={8}
                  />
                </div>
                {error && <div className="home-error">{error}</div>}
                <button className="home-btn primary" onClick={handleJoin}>Join Session →</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Modal */}
      {modalState && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "24px", width: "400px", maxWidth: "90%", boxShadow: "var(--shadow)" }}>
            <h3 style={{ marginBottom: "16px", color: "var(--text)" }}>
              {modalState.type === "CREATE_FOLDER" ? "Create New Folder" : modalState.type === "RENAME_FOLDER" ? "Rename Folder" : "Move Session to Folder"}
            </h3>

            {modalState.type === "MOVE_SESSION" ? (
              <select autoFocus className="home-input" style={{ width: "100%", marginBottom: "20px" }} value={modalInput} onChange={(e) => setModalInput(e.target.value)}>
                <option value="">-- Unorganized --</option>
                {folders.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
              </select>
            ) : (
              <input
                autoFocus
                className="home-input"
                style={{ width: "100%", marginBottom: "20px" }}
                placeholder="Folder name..."
                value={modalInput}
                onChange={(e) => setModalInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleModalSubmit(); }}
              />
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button onClick={() => setModalState(null)} className="home-btn" style={{ background: "var(--bg3)", color: "var(--text2)", border: "none" }}>Cancel</button>
              <button onClick={handleModalSubmit} className="home-btn primary">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomeScreen;
