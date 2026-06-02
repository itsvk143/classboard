// HomeScreen.jsx — Classroom dashboard for logged-in teachers
import React, { useState, useEffect, useCallback } from "react";
import "../App.css";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../config";
import { useAuth } from "../AuthContext";

const HomeScreen = () => {
  const navigate = useNavigate();
  const { user, authFetch, logout } = useAuth();

  // Pre-fill create form with Google profile (teacher can override)
  const [tab,          setTab]          = useState("create");
  const [name,         setName]         = useState(user?.name  || "");
  const [email,        setEmail]        = useState(user?.email || "");
  const [sessionTitle, setSessionTitle] = useState("");
  const [code,         setCode]         = useState("");
  const [error,        setError]        = useState("");

  // 🛡️ Admin Dashboard States
  const [activeWorkspace, setActiveWorkspace] = useState("workspace");
  const [adminTab, setActiveAdminTab] = useState("teachers");
  const [adminTeachers, setAdminTeachers] = useState([]);
  const [adminSessions, setAdminSessions] = useState([]);
  const [adminSearch, setAdminSearch] = useState("");
  const [loadingAdmin, setLoadingAdmin] = useState(false);

  // Modals for Banning & Editing
  const [banModal, setBanModal] = useState(null); // { teacher }
  const [banExpiresAt, setBanExpiresAt] = useState("");
  const [banReason, setBanReason] = useState("");

  const [editSessionModal, setEditSessionModal] = useState(null); // { session }
  const [editSessionTitle, setEditSessionTitle] = useState("");
  const [editSessionActive, setEditSessionActive] = useState(true);

  // Sync if user info arrives later (e.g. after token restore)
  useEffect(() => {
    if (user) {
      setName(n  => n  || user.name  || "");
      setEmail(e => e  || user.email || "");
    }
  }, [user]);

  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [folders, setFolders] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState({});

  // Multi-select state (works on all folders, especially Unorganized)
  const [selectedSessions, setSelectedSessions] = useState(new Set());

  // Modal State for folder management
  const [modalState, setModalState] = useState(null);
  const [modalInput, setModalInput] = useState("");

  // 🛡️ Admin Dashboard Action Handlers
  const loadAdminData = useCallback(() => {
    if (user?.role !== "admin") return;
    setLoadingAdmin(true);
    authFetch(`${API_BASE_URL}/api/admin/teachers`)
      .then(r => {
        if (!r.ok) throw new Error("Unauthorized");
        return r.json();
      })
      .then(data => {
        setAdminTeachers(Array.isArray(data) ? data : []);
      })
      .catch(err => console.error("Admin fetch teachers error:", err));

    authFetch(`${API_BASE_URL}/api/sessions`)
      .then(r => r.json())
      .then(data => {
        setAdminSessions(Array.isArray(data) ? data : []);
        setLoadingAdmin(false);
      })
      .catch(err => {
        console.error("Admin fetch sessions error:", err);
        setLoadingAdmin(false);
      });
  }, [user, authFetch]);

  useEffect(() => {
    if (activeWorkspace === "admin") {
      loadAdminData();
    }
  }, [activeWorkspace, loadAdminData]);

  const handleBanTeacher = (teacher, perm = false) => {
    if (perm) {
      if (!window.confirm(`Permanently ban ${teacher.name} (${teacher.email})?`)) return;
      authFetch(`${API_BASE_URL}/api/admin/teachers/${teacher.googleId}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isBanned: true, banExpiresAt: null, banReason: "Violated community guidelines" })
      }).then(() => {
        loadAdminData();
      });
    } else {
      setBanExpiresAt("");
      setBanReason("");
      setBanModal({ teacher });
    }
  };

  const handleSaveBan = () => {
    if (!banModal) return;
    const { teacher } = banModal;
    authFetch(`${API_BASE_URL}/api/admin/teachers/${teacher.googleId}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isBanned: true,
        banExpiresAt: banExpiresAt || null,
        banReason: banReason || "Violated terms of service"
      })
    }).then(() => {
      setBanModal(null);
      loadAdminData();
    });
  };

  const handleUnbanTeacher = (teacher) => {
    if (!window.confirm(`Lift ban for ${teacher.name} (${teacher.email})?`)) return;
    authFetch(`${API_BASE_URL}/api/admin/teachers/${teacher.googleId}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isBanned: false, banExpiresAt: null, banReason: "" })
    }).then(() => {
      loadAdminData();
    });
  };

  const handleDeleteTeacher = (teacher) => {
    if (!window.confirm(`WARNING: This will permanently delete ${teacher.name}'s (${teacher.email}) account. This CANNOT be undone. Proceed?`)) return;
    authFetch(`${API_BASE_URL}/api/admin/teachers/${teacher.googleId}`, {
      method: "DELETE"
    }).then(() => {
      loadAdminData();
    });
  };

  const handleEditSession = (session) => {
    setEditSessionTitle(session.title || "");
    setEditSessionActive(session.active);
    setEditSessionModal({ session });
  };

  const handleSaveSessionEdit = () => {
    if (!editSessionModal) return;
    const { session } = editSessionModal;
    authFetch(`${API_BASE_URL}/api/admin/sessions/${session.code}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editSessionTitle,
        active: editSessionActive
      })
    }).then(() => {
      setEditSessionModal(null);
      loadAdminData();
      loadData();
    });
  };

  const handleDeleteSessionAdmin = (session) => {
    if (!window.confirm(`Permanently delete session "${session.title}" (${session.code}) and all its snapshot data?`)) return;
    authFetch(`${API_BASE_URL}/api/admin/sessions/${session.code}`, {
      method: "DELETE"
    }).then(() => {
      loadAdminData();
      loadData();
    });
  };

  const loadData = useCallback(() => {
    authFetch(`${API_BASE_URL}/api/sessions`)
      .then((r) => r.json())
      .then((data) => { setSessions(Array.isArray(data) ? data : []); setLoadingSessions(false); })
      .catch((e) => { console.error(e); setLoadingSessions(false); });

    authFetch(`${API_BASE_URL}/api/folders`)
      .then(r => r.json())
      .then(data => setFolders(Array.isArray(data) ? data : []))
      .catch(e => console.error(e));
  }, [authFetch]);

  useEffect(() => { loadData(); }, [loadData]);

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
    authFetch(`${API_BASE_URL}/api/sessions/${sessionCode}`, { method: "DELETE" })
      .then(() => {
        setSelectedSessions(prev => { const n = new Set(prev); n.delete(sessionCode); return n; });
        loadData();
      });
  };

  const bulkDelete = (codes) => {
    if (codes.length === 0) return;
    if (!window.confirm(`Delete ${codes.length} session(s)? This cannot be undone.`)) return;
    authFetch(`${API_BASE_URL}/api/sessions/bulk-delete`, {
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
    fetch(`${API_BASE_URL}/api/folders/${id}`, { method: "DELETE" }).then(() => loadData());
  };

  const handleModalSubmit = () => {
    if (!modalState) return;
    const { type } = modalState;
    const val = modalInput.trim();

    if (type === "CREATE_FOLDER") {
      if (!val) { setModalState(null); return; }
      fetch(`${API_BASE_URL}/api/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: val })
      }).then(() => { loadData(); setModalState(null); });
    } else if (type === "RENAME_FOLDER") {
      const { id, currentName } = modalState;
      if (!val || val === currentName) { setModalState(null); return; }
      fetch(`${API_BASE_URL}/api/folders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: val })
      }).then(() => { loadData(); setModalState(null); });
    } else if (type === "MOVE_SESSION") {
      const { code: sessionCode } = modalState;
      const doMove = () => {
        fetch(`${API_BASE_URL}/api/sessions/${sessionCode}/folder`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: val })
        }).then(() => { loadData(); setModalState(null); });
      };
      if (val !== "" && !folders.find(f => f.name === val)) {
        fetch(`${API_BASE_URL}/api/folders`, {
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
    if (!sessionTitle.trim()) { setError("Please enter a class title."); return; }
    setError("");
    navigate("/classroom", {
      state: {
        action: "create",
        name:   user?.name  || name,
        email:  user?.email || email,
        sessionTitle,
        isTeacher: true,
      },
    });
  };

  const handleJoin = () => {
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (!code.trim()) { setError("Please enter a session code."); return; }
    setError("");
    navigate("/classroom", {
      state: {
        action: "join",
        name:   user?.name  || name,
        email:  user?.email || email,
        code: code.toUpperCase(),
        isTeacher: false,
      },
    });
  };

  return (
    <div className="home-screen" style={{ padding: "0 0 80px 0", background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(79,142,247,0.1) 0%, transparent 70%), var(--bg)" }}>
      {/* ── Fixed/Sticky Glassmorphism Navigation Bar ── */}
      <nav style={{
        width: "100%",
        position: "sticky",
        top: 0,
        zIndex: 100,
        backdropFilter: "blur(18px) saturate(180%)",
        background: "rgba(13, 17, 23, 0.75)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        padding: "14px 40px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow: "0 4px 30px rgba(0, 0, 0, 0.1)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "28px", filter: "drop-shadow(0 0 10px rgba(79,142,247,0.5))" }}>🖊️</span>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "22px", fontWeight: "700", background: "linear-gradient(135deg, #ffffff 0%, var(--primary) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-0.5px" }}>ClassBoard</span>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(255,255,255,0.03)", padding: "6px 14px", borderRadius: "30px", border: "1px solid rgba(255,255,255,0.06)" }}>
            {user?.picture ? (
              <img src={user.picture} alt="avatar" style={{ width: "24px", height: "24px", borderRadius: "50%", border: "1px solid rgba(79,142,247,0.3)" }} />
            ) : (
              <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "bold" }}>{user?.name?.[0]}</div>
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ color: "#f1f5f9", fontWeight: "600", fontSize: "12px", lineHeight: "1.2" }}>{user?.name}</span>
              <span style={{ color: "var(--text3)", fontSize: "10px" }}>{user?.role === "admin" ? "🔑 Admin" : "👩‍🏫 Teacher"}</span>
            </div>
          </div>
          <button
            onClick={logout}
            style={{
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              borderRadius: "30px",
              color: "#fca5a5",
              cursor: "pointer",
              fontSize: "12px",
              padding: "8px 16px",
              fontWeight: "600",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => { e.target.style.background = "rgba(239, 68, 68, 0.2)"; e.target.style.borderColor = "rgba(239, 68, 68, 0.35)"; }}
            onMouseLeave={(e) => { e.target.style.background = "rgba(239, 68, 68, 0.08)"; e.target.style.borderColor = "rgba(239, 68, 68, 0.2)"; }}
          >
            Sign Out
          </button>
        </div>
      </nav>

      {/* ── Main Content Container ── */}
      <div style={{ width: "100%", maxWidth: "1300px", marginTop: "40px", padding: "0 24px", display: "flex", flexDirection: "column", gap: "32px" }}>
        
        {/* ── Welcome & Realtime Stats Overview ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <h1 style={{ fontSize: "32px", fontWeight: "800", color: "#f8fafc", margin: 0, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "-0.5px" }}>
                Welcome back, {user?.name?.split(" ")[0] || "Teacher"} 👋
              </h1>
              <p style={{ color: "var(--text2)", fontSize: "14px", marginTop: "6px", margin: 0 }}>
                Launch collaborative rooms instantly, manage organized folders, and access student canvas snap-back history.
              </p>
            </div>
            
            {user?.role === "admin" && (
              <div style={{ display: "flex", background: "rgba(0,0,0,0.35)", borderRadius: "30px", padding: "4px", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(10px)" }}>
                <button
                  type="button"
                  onClick={() => setActiveWorkspace("workspace")}
                  style={{
                    padding: "8px 18px",
                    border: "none",
                    borderRadius: "24px",
                    background: activeWorkspace === "workspace" ? "var(--primary)" : "transparent",
                    color: activeWorkspace === "workspace" ? "#ffffff" : "#94a3b8",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    boxShadow: activeWorkspace === "workspace" ? "0 4px 12px rgba(79,142,247,0.3)" : "none"
                  }}
                >
                  🏫 Teacher Workspace
                </button>
                <button
                  type="button"
                  onClick={() => setActiveWorkspace("admin")}
                  style={{
                    padding: "8px 18px",
                    border: "none",
                    borderRadius: "24px",
                    background: activeWorkspace === "admin" ? "linear-gradient(135deg, #f59e0b, #d97706)" : "transparent",
                    color: activeWorkspace === "admin" ? "#ffffff" : "#94a3b8",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    boxShadow: activeWorkspace === "admin" ? "0 4px 12px rgba(245,158,11,0.3)" : "none"
                  }}
                >
                  🔑 Admin Dashboard
                </button>
              </div>
            )}
          </div>

          {/* Stats Bar */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "16px"
          }}>
            <div style={{ background: "linear-gradient(135deg, rgba(22,27,34,0.4) 0%, rgba(13,17,23,0.4) 100%)", backdropFilter: "blur(12px)", border: "1px solid var(--border)", padding: "20px", borderRadius: "16px", display: "flex", alignItems: "center", gap: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>
              <div style={{ background: "rgba(79,142,247,0.1)", borderRadius: "12px", width: "48px", height: "48px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>📋</div>
              <div>
                <div style={{ fontSize: "24px", fontWeight: "800", color: "#f1f5f9", fontFamily: "'Space Grotesk', sans-serif" }}>{sessions.length}</div>
                <div style={{ fontSize: "12px", color: "var(--text2)", fontWeight: "500", marginTop: "2px" }}>Total Class Sessions</div>
              </div>
            </div>

            <div style={{ background: "linear-gradient(135deg, rgba(22,27,34,0.4) 0%, rgba(13,17,23,0.4) 100%)", backdropFilter: "blur(12px)", border: "1px solid var(--border)", padding: "20px", borderRadius: "16px", display: "flex", alignItems: "center", gap: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>
              <div style={{ background: "rgba(34,197,94,0.1)", borderRadius: "12px", width: "48px", height: "48px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", position: "relative" }}>
                🟢
                {sessions.some(s => s.active) && (
                  <span style={{ position: "absolute", top: "10px", right: "10px", width: "8px", height: "8px", background: "#22c55e", borderRadius: "50%", boxShadow: "0 0 10px #22c55e" }} />
                )}
              </div>
              <div>
                <div style={{ fontSize: "24px", fontWeight: "800", color: "#f1f5f9", fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: "10px" }}>
                  {sessions.filter(s => s.active).length}
                  {sessions.some(s => s.active) && (
                    <span style={{ fontSize: "10px", background: "rgba(34, 197, 94, 0.15)", color: "#4ade80", padding: "2px 8px", borderRadius: "20px", fontWeight: "bold" }}>LIVE NOW</span>
                  )}
                </div>
                <div style={{ fontSize: "12px", color: "var(--text2)", fontWeight: "500", marginTop: "2px" }}>Active Live Classes</div>
              </div>
            </div>

            <div style={{ background: "linear-gradient(135deg, rgba(22,27,34,0.4) 0%, rgba(13,17,23,0.4) 100%)", backdropFilter: "blur(12px)", border: "1px solid var(--border)", padding: "20px", borderRadius: "16px", display: "flex", alignItems: "center", gap: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>
              <div style={{ background: "rgba(245,158,11,0.1)", borderRadius: "12px", width: "48px", height: "48px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>📁</div>
              <div>
                <div style={{ fontSize: "24px", fontWeight: "800", color: "#f1f5f9", fontFamily: "'Space Grotesk', sans-serif" }}>{folders.length}</div>
                <div style={{ fontSize: "12px", color: "var(--text2)", fontWeight: "500", marginTop: "2px" }}>Organized Folders</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Dashboard Panels Split Layout ── */}
        <div style={{ display: "flex", gap: "32px", width: "100%", flexWrap: "wrap" }}>
          
          {activeWorkspace === "admin" ? (
            /* 🔑 FULL-WIDTH / FLEXIBLE ADMIN PANEL ── */
            <div style={{ flex: "2", minWidth: "350px", display: "flex", flexDirection: "column", gap: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "24px" }}>🛡️</span>
                  <h2 style={{ fontSize: "22px", fontWeight: "800", color: "#f8fafc", margin: 0, fontFamily: "'Space Grotesk', sans-serif" }}>Administrative Controls</h2>
                </div>

                {/* Search & Tab row */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <input
                    type="text"
                    placeholder={adminTab === "teachers" ? "Search teachers..." : "Search sessions..."}
                    value={adminSearch}
                    onChange={(e) => setAdminSearch(e.target.value)}
                    style={{
                      background: "rgba(13,17,23,0.5)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "10px",
                      padding: "8px 16px",
                      fontSize: "13px",
                      color: "#f1f5f9",
                      width: "220px",
                      outline: "none",
                      borderStyle: "solid"
                    }}
                  />

                  <div style={{ display: "flex", background: "rgba(0,0,0,0.2)", borderRadius: "10px", padding: "3px", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <button
                      type="button"
                      onClick={() => { setActiveAdminTab("teachers"); setAdminSearch(""); }}
                      style={{
                        padding: "6px 12px",
                        border: "none",
                        borderRadius: "6px",
                        background: adminTab === "teachers" ? "rgba(255,255,255,0.08)" : "transparent",
                        color: adminTab === "teachers" ? "#ffffff" : "#94a3b8",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                        transition: "all 0.15s"
                      }}
                    >
                      👩‍🏫 Teachers ({adminTeachers.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => { setActiveAdminTab("sessions"); setAdminSearch(""); }}
                      style={{
                        padding: "6px 12px",
                        border: "none",
                        borderRadius: "6px",
                        background: adminTab === "sessions" ? "rgba(255,255,255,0.08)" : "transparent",
                        color: adminTab === "sessions" ? "#ffffff" : "#94a3b8",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                        transition: "all 0.15s"
                      }}
                    >
                      📺 All Sessions ({adminSessions.length})
                    </button>
                  </div>
                </div>
              </div>

              {loadingAdmin ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 0", gap: "12px" }}>
                  <div style={{ width: "32px", height: "32px", border: "3px solid rgba(245,158,11,0.1)", borderTopColor: "#f59e0b", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                  <span style={{ color: "var(--text3)", fontSize: "14px" }}>Loading administrative records...</span>
                </div>
              ) : adminTab === "teachers" ? (
                /* 👩‍🏫 REGISTERED TEACHERS ADMIN TAB ── */
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {adminTeachers
                    .filter(t => t.name.toLowerCase().includes(adminSearch.toLowerCase()) || t.email.toLowerCase().includes(adminSearch.toLowerCase()))
                    .map(teacher => {
                      const isTempBanned = teacher.banExpiresAt && new Date(teacher.banExpiresAt) > new Date();
                      const isPermBanned = teacher.isBanned && !teacher.banExpiresAt;
                      const isCurrentlyBanned = isPermBanned || isTempBanned;

                      return (
                        <div
                          key={teacher.googleId}
                          style={{
                            background: "rgba(22,27,34,0.4)",
                            border: "1px solid var(--border)",
                            borderRadius: "16px",
                            padding: "16px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "16px",
                            boxShadow: "0 4px 20px rgba(0,0,0,0.1)"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                            {teacher.picture ? (
                              <img src={teacher.picture} alt="avatar" style={{ width: "42px", height: "42px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.06)" }} />
                            ) : (
                              <div style={{ width: "42px", height: "42px", borderRadius: "50%", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: "bold" }}>{teacher.name?.[0]}</div>
                            )}
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontWeight: "700", fontSize: "15px", color: "#f1f5f9" }}>{teacher.name}</span>
                                <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "10px", background: teacher.role === "admin" ? "rgba(245,158,11,0.15)" : "rgba(79,142,247,0.1)", color: teacher.role === "admin" ? "#fbbf24" : "var(--primary)", fontWeight: "700" }}>
                                  {teacher.role.toUpperCase()}
                                </span>
                              </div>
                              <div style={{ fontSize: "12px", color: "var(--text3)", marginTop: "2px" }}>{teacher.email}</div>
                              <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "4px" }}>Registered: {formatDate(teacher.createdAt)}</div>
                            </div>
                          </div>

                          {/* Ban badges & admin action buttons */}
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                            {isCurrentlyBanned && (
                              <div style={{
                                background: "rgba(239, 68, 68, 0.12)",
                                border: "1px solid rgba(239, 68, 68, 0.25)",
                                borderRadius: "8px",
                                padding: "6px 12px",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "flex-start",
                                gap: "2px"
                              }}>
                                <span style={{ color: "#ef4444", fontSize: "11px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                  ⚠️ {isPermBanned ? "Permanently Banned" : "Temporarily Banned"}
                                </span>
                                {isTempBanned && (
                                  <span style={{ fontSize: "10px", color: "#fca5a5" }}>
                                    Expires: {new Date(teacher.banExpiresAt).toLocaleString()}
                                  </span>
                                )}
                                {teacher.banReason && (
                                  <span style={{ fontSize: "10px", color: "#f87171", fontStyle: "italic" }}>
                                    "{teacher.banReason}"
                                  </span>
                                )}
                              </div>
                            )}

                            {teacher.googleId !== user?.googleId && (
                              <div style={{ display: "flex", gap: "8px" }}>
                                {isCurrentlyBanned ? (
                                  <button
                                    onClick={() => handleUnbanTeacher(teacher)}
                                    style={{
                                      background: "rgba(34, 197, 94, 0.12)",
                                      border: "1px solid rgba(34, 197, 94, 0.25)",
                                      color: "#4ade80",
                                      padding: "6px 12px",
                                      borderRadius: "8px",
                                      fontSize: "12px",
                                      fontWeight: "600",
                                      cursor: "pointer",
                                      transition: "all 0.15s"
                                    }}
                                  >
                                    🟢 Lift Ban
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handleBanTeacher(teacher, false)}
                                      style={{
                                        background: "rgba(245, 158, 11, 0.1)",
                                        border: "1px solid rgba(245, 158, 11, 0.2)",
                                        color: "#f59e0b",
                                        padding: "6px 12px",
                                        borderRadius: "8px",
                                        fontSize: "12px",
                                        fontWeight: "600",
                                        cursor: "pointer",
                                        transition: "all 0.15s"
                                      }}
                                    >
                                      ⏳ Temp Ban
                                    </button>
                                    <button
                                      onClick={() => handleBanTeacher(teacher, true)}
                                      style={{
                                        background: "rgba(239, 68, 68, 0.08)",
                                        border: "1px solid rgba(239, 68, 68, 0.2)",
                                        color: "#ef4444",
                                        padding: "6px 12px",
                                        borderRadius: "8px",
                                        fontSize: "12px",
                                        fontWeight: "600",
                                        cursor: "pointer",
                                        transition: "all 0.15s"
                                      }}
                                    >
                                      🛑 Perm Ban
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={() => handleDeleteTeacher(teacher)}
                                  style={{
                                    background: "rgba(239, 68, 68, 0.05)",
                                    border: "1px solid rgba(239, 68, 68, 0.15)",
                                    color: "#f87171",
                                    padding: "6px 12px",
                                    borderRadius: "8px",
                                    fontSize: "12px",
                                    fontWeight: "600",
                                    cursor: "pointer",
                                    transition: "all 0.15s"
                                  }}
                                  title="Delete Account"
                                >
                                  🗑️ Delete
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : (
                /* 📺 CLASS SESSIONS ADMIN TAB ── */
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: "16px" }}>
                  {adminSessions
                    .filter(s => s.code.toLowerCase().includes(adminSearch.toLowerCase()) || s.title.toLowerCase().includes(adminSearch.toLowerCase()))
                    .map(s => (
                      <div
                        key={s.code}
                        style={{
                          background: "rgba(22,27,34,0.4)",
                          border: "1px solid var(--border)",
                          borderRadius: "16px",
                          padding: "16px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "12px",
                          boxShadow: "0 4px 20px rgba(0,0,0,0.1)"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                          <div>
                            <div style={{ fontWeight: "700", fontSize: "14px", color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{s.title}</div>
                            <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "2px" }}>Code: <span style={{ fontFamily: "monospace", color: "var(--primary)", fontWeight: "bold" }}>{s.code}</span></div>
                          </div>
                          
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              onClick={() => handleEditSession(s)}
                              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", color: "#cbd5e1", width: "26px", height: "26px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "12px", transition: "all 0.15s" }}
                              title="Edit Session"
                            >✏️</button>
                            <button
                              onClick={() => handleDeleteSessionAdmin(s)}
                              style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171", width: "26px", height: "26px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "12px", transition: "all 0.15s" }}
                              title="Delete Session"
                            >🗑️</button>
                          </div>
                        </div>

                        <div style={{ fontSize: "11px", color: "#94a3b8", display: "flex", flexDirection: "column", gap: "4px", borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                            <span style={{
                              display: "inline-block",
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              background: s.active ? "#22c55e" : "#64748b",
                              boxShadow: s.active ? "0 0 6px #22c55e" : "none"
                            }} />
                            <span style={{ color: s.active ? "#4ade80" : "#64748b", fontWeight: "700", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                              {s.active ? "Live Room" : "Ended"}
                            </span>
                          </div>
                          <div>👤 Teacher: <span style={{ fontWeight: "600" }}>{s.createdBy}</span> ({s.teacherEmail})</div>
                          <div>🕐 Created: {formatDate(s.createdAt)}</div>
                          {s.endedAt && <div>⏱ Ended: {formatDate(s.endedAt)}</div>}
                          <div>📂 Folder: <span style={{ fontStyle: s.folder ? "normal" : "italic" }}>{s.folder || "None"}</span></div>
                          <div>📦 Snapshots: {s.snapshotCount || 0}</div>
                        </div>

                        <button
                          onClick={() => navigate(`/replay/${s.code}`)}
                          style={{
                            background: "rgba(79,142,247,0.08)",
                            border: "1px solid rgba(79,142,247,0.18)",
                            color: "var(--primary)",
                            borderRadius: "8px",
                            padding: "6px 0",
                            fontSize: "12px",
                            fontWeight: "700",
                            cursor: "pointer",
                            transition: "all 0.15s",
                            marginTop: "4px"
                          }}
                        >
                          👁️ View Replay & Logs
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            /* 🏫 Left Panel: Past Sessions and Folder Organization */
            <div style={{ flex: "2", minWidth: "350px", display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "22px" }}>📋</span>
                <h2 style={{ fontSize: "20px", fontWeight: "700", color: "#f1f5f9", margin: 0 }}>Classroom Workspace</h2>
              </div>
              <button
                type="button"
                onClick={handleCreateFolder}
                style={{
                  background: "rgba(79,142,247,0.12)",
                  border: "1px solid rgba(79,142,247,0.25)",
                  borderRadius: "30px",
                  color: "var(--primary)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  padding: "6px 14px",
                  fontWeight: "600",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => { e.target.style.background = "rgba(79,142,247,0.2)"; }}
                onMouseLeave={(e) => { e.target.style.background = "rgba(79,142,247,0.12)"; }}
                title="Create New Folder"
              >
                <span>+</span> New Folder
              </button>
            </div>

            {loadingSessions ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 0", gap: "12px" }}>
                <div style={{ width: "32px", height: "32px", border: "3px solid rgba(79,142,247,0.1)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 1s linear infinite" }} className="animate-spin" />
                <span style={{ color: "var(--text3)", fontSize: "14px" }}>Retrieving classroom data...</span>
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 40px", background: "rgba(22,27,34,0.3)", border: "1px dashed var(--border)", borderRadius: "20px", textAlign: "center" }}>
                <div style={{ fontSize: "40px", marginBottom: "16px", filter: "drop-shadow(0 0 10px rgba(79,142,247,0.25))" }}>🎓</div>
                <h3 style={{ fontSize: "16px", fontWeight: "600", color: "#e2e8f0", margin: "0 0 6px 0" }}>No sessions yet</h3>
                <p style={{ color: "var(--text3)", fontSize: "13px", margin: 0, maxWidth: "280px" }}>Create your very first live class session on the right to get started!</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
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
                          background: "rgba(22,27,34,0.4)",
                          backdropFilter: "blur(8px)",
                          border: "1px solid var(--border)",
                          borderRadius: "18px",
                          padding: "16px",
                          transition: "all 0.2s ease",
                          cursor: isExpanded ? "default" : "pointer",
                          boxShadow: "0 4px 20px rgba(0,0,0,0.1)"
                        }}
                        onClick={() => { if (!isExpanded) toggleFolder(folderName); }}
                        onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.borderColor = "rgba(79,142,247,0.3)"; }}
                        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.borderColor = "var(--border)"; }}
                      >
                        {/* Folder Header */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: isExpanded ? "1px solid rgba(255,255,255,0.06)" : "none", paddingBottom: isExpanded ? "12px" : "0", marginBottom: isExpanded ? "16px" : "0", gap: "8px" }}>
                          <div
                            onClick={(e) => { e.stopPropagation(); toggleFolder(folderName); }}
                            style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", flex: 1 }}
                          >
                            <span style={{ fontSize: "20px", display: "flex", alignItems: "center", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.15))" }}>
                              {isExpanded ? "📂" : "📁"}
                            </span>
                            <span style={{ fontSize: "15px", fontWeight: "600", color: "#f1f5f9" }}>{folderName}</span>
                            <span style={{ fontSize: "11px", color: "var(--text3)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.05)", padding: "2px 8px", borderRadius: "10px", fontWeight: "600" }}>
                              {folderCodes.length} {folderCodes.length === 1 ? "session" : "sessions"}
                            </span>
                          </div>

                          <div style={{ display: "flex", gap: "8px", alignItems: "center" }} onClick={e => e.stopPropagation()}>
                            {isUnorganized && isExpanded && folderCodes.length > 0 && (
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  type="button"
                                  onClick={() => handleSelectAll(folderCodes)}
                                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "#94a3b8", cursor: "pointer", fontSize: "11px", padding: "4px 10px", borderRadius: "6px", fontWeight: "600", transition: "all 0.15s" }}
                                  onMouseEnter={(e) => e.target.style.background = "rgba(255,255,255,0.08)"}
                                  onMouseLeave={(e) => e.target.style.background = "rgba(255,255,255,0.04)"}
                                >
                                  {allSelected ? "✓ Deselect" : "☐ Select All"}
                                </button>

                                {selectedInFolder.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => bulkDelete(selectedInFolder)}
                                    style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", cursor: "pointer", fontSize: "11px", padding: "4px 10px", borderRadius: "6px", fontWeight: "700", transition: "all 0.15s" }}
                                    onMouseEnter={(e) => e.target.style.background = "rgba(239,68,68,0.25)"}
                                    onMouseLeave={(e) => e.target.style.background = "rgba(239,68,68,0.15)"}
                                  >
                                    🗑 Delete Selected ({selectedInFolder.length})
                                  </button>
                                )}
                              </div>
                            )}

                            {folderObj && (
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  type="button"
                                  onClick={(e) => handleRenameFolder(folderObj.id, folderObj.name, e)}
                                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", color: "#cbd5e1", cursor: "pointer", fontSize: "12px", width: "26px", height: "26px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
                                  onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                                  title="Rename Folder"
                                >✏️</button>
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteFolder(folderObj.id, e)}
                                  style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171", cursor: "pointer", fontSize: "12px", width: "26px", height: "26px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(239,68,68,0.15)"}
                                  onMouseLeave={(e) => e.currentTarget.style.background = "rgba(239,68,68,0.05)"}
                                  title="Delete Folder"
                                >🗑️</button>
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => toggleFolder(folderName)}
                              style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: "12px", padding: "0 4px", display: "flex", alignItems: "center", justifyContent: "center" }}
                            >
                              {isExpanded ? "▲" : "▼"}
                            </button>
                          </div>
                        </div>

                        {/* Folder Expansion (Grid List of Sessions) */}
                        {isExpanded && (
                          groupedSessions[folderName].length === 0 ? (
                            <div style={{ color: "var(--text3)", fontSize: "13px", fontStyle: "italic", textAlign: "center", padding: "24px 0" }}>Empty folder. Move sessions here to organize.</div>
                          ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px", marginTop: "8px" }}>
                              {groupedSessions[folderName].map((s) => {
                                const isSelected = selectedSessions.has(s.code);
                                return (
                                  <div
                                    key={s.code}
                                    style={{
                                      cursor: "pointer",
                                      padding: "14px",
                                      background: isSelected ? "rgba(79,142,247,0.06)" : "rgba(13,17,23,0.3)",
                                      border: isSelected ? "1px solid var(--primary)" : "1px solid var(--border)",
                                      borderRadius: "12px",
                                      position: "relative",
                                      transition: "all 0.15s ease",
                                      boxShadow: "0 2px 8px rgba(0,0,0,0.15)"
                                    }}
                                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
                                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--border)"; }}
                                  >
                                    {isUnorganized && (
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={(e) => handleToggleSelect(s.code, e)}
                                        onClick={(e) => e.stopPropagation()}
                                        style={{ position: "absolute", top: "16px", left: "12px", width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--primary)" }}
                                      />
                                    )}

                                    <div
                                      onClick={() => navigate(`/replay/${s.code}`)}
                                      style={{ paddingLeft: isUnorganized ? "24px" : "0" }}
                                    >
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "8px" }}>
                                        <div style={{ fontWeight: "600", fontSize: "14px", color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }} title={s.title}>{s.title}</div>
                                        
                                        <div style={{ display: "flex", gap: "4px", alignItems: "center" }} onClick={e => e.stopPropagation()}>
                                          <div style={{ fontFamily: "monospace", color: "var(--primary)", background: "rgba(79,142,247,0.08)", border: "1px solid rgba(79,142,247,0.15)", padding: "1px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: "700" }}>{s.code}</div>
                                          <button
                                            type="button"
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleMoveToFolder(s.code, s.folder); }}
                                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", cursor: "pointer", fontSize: "10px", width: "22px", height: "22px", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", color: "#cbd5e1" }}
                                            title="Move to Folder"
                                          >📂</button>
                                          <button
                                            type="button"
                                            onClick={(e) => deleteSession(s.code, e)}
                                            style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", cursor: "pointer", fontSize: "10px", width: "22px", height: "22px", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171" }}
                                            title="Delete Session"
                                          >🗑</button>
                                        </div>
                                      </div>

                                      <div style={{ fontSize: "11px", color: "#94a3b8", display: "flex", flexDirection: "column", gap: "4px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                          <span style={{
                                            display: "inline-block",
                                            width: "6px",
                                            height: "6px",
                                            borderRadius: "50%",
                                            background: s.active ? "#22c55e" : "#64748b",
                                            boxShadow: s.active ? "0 0 6px #22c55e" : "none"
                                          }} />
                                          <span style={{ color: s.active ? "#4ade80" : "#64748b", fontWeight: "600", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                            {s.active ? "Live Room" : "Ended"}
                                          </span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>👤 <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{s.createdBy}</span></div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>🕐 <span>{formatDate(s.createdAt)}</span></div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>⏱ <span>Duration: {duration(s)}</span></div>
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
          )}

          {/* Right Panel: Sleek Card containing tabs to Join / Create classrooms */}
          <div style={{ flex: "1", minWidth: "300px", display: "flex", flexDirection: "column" }}>
            <div style={{
              background: "linear-gradient(135deg, rgba(22,27,34,0.7) 0%, rgba(13,17,23,0.7) 100%)",
              backdropFilter: "blur(16px)",
              border: "1px solid var(--border)",
              borderRadius: "24px",
              padding: "32px 28px",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4), var(--shadow-glow)",
              display: "flex",
              flexDirection: "column",
              gap: "20px"
            }}>
              
              {/* Tab Navigation row */}
              <div style={{ display: "flex", background: "rgba(0,0,0,0.2)", borderRadius: "12px", padding: "4px", border: "1px solid rgba(255,255,255,0.04)" }}>
                <button
                  onClick={() => { setTab("join"); setError(""); }}
                  style={{
                    flex: "1",
                    padding: "10px 0",
                    border: "none",
                    borderRadius: "8px",
                    background: tab === "join" ? "var(--primary)" : "transparent",
                    color: tab === "join" ? "#ffffff" : "#94a3b8",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: tab === "join" ? "0 4px 12px rgba(79,142,247,0.3)" : "none"
                  }}
                >
                  🏫 Join Class
                </button>
                <button
                  onClick={() => { setTab("create"); setError(""); }}
                  style={{
                    flex: "1",
                    padding: "10px 0",
                    border: "none",
                    borderRadius: "8px",
                    background: tab === "create" ? "var(--primary)" : "transparent",
                    color: tab === "create" ? "#ffffff" : "#94a3b8",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: tab === "create" ? "0 4px 12px rgba(79,142,247,0.3)" : "none"
                  }}
                >
                  🚀 Create Class
                </button>
              </div>

              {/* Form Input Fields */}
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div className="home-field" style={{ margin: 0 }}>
                  <label style={{ fontSize: "12px", color: "#cbd5e1", fontWeight: "600", marginBottom: "4px" }}>Your Screen Name</label>
                  <input
                    className="home-input"
                    style={{ background: "rgba(13,17,23,0.5)", border: "1px solid rgba(255,255,255,0.06)", padding: "12px 14px", borderRadius: "10px", fontSize: "14px" }}
                    placeholder="Enter your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="home-field" style={{ margin: 0 }}>
                  <label style={{ fontSize: "12px", color: "#cbd5e1", fontWeight: "600", marginBottom: "4px" }}>Email <span style={{ color: "var(--text3)" }}>(optional)</span></label>
                  <input
                    className="home-input"
                    style={{ background: "rgba(13,17,23,0.5)", border: "1px solid rgba(255,255,255,0.06)", padding: "12px 14px", borderRadius: "10px", fontSize: "14px" }}
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  />
                </div>

                {tab === "create" && (
                  <div className="home-field" style={{ margin: 0 }}>
                    <label style={{ fontSize: "12px", color: "#cbd5e1", fontWeight: "600", marginBottom: "4px" }}>Class Title</label>
                    <input
                      className="home-input"
                      style={{ background: "rgba(13,17,23,0.5)", border: "1px solid rgba(255,255,255,0.06)", padding: "12px 14px", borderRadius: "10px", fontSize: "14px" }}
                      placeholder="e.g. Physics – Chapter 3"
                      value={sessionTitle}
                      onChange={(e) => setSessionTitle(e.target.value)}
                    />
                  </div>
                )}

                {tab === "join" && (
                  <div className="home-field" style={{ margin: 0 }}>
                    <label style={{ fontSize: "12px", color: "#cbd5e1", fontWeight: "600", marginBottom: "4px" }}>Session Entry Code</label>
                    <input
                      className="home-input"
                      style={{
                        background: "rgba(13,17,23,0.5)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        padding: "12px 14px",
                        borderRadius: "10px",
                        letterSpacing: "4px",
                        fontWeight: "700",
                        fontSize: "16px",
                        textAlign: "center",
                        color: "var(--primary)"
                      }}
                      placeholder="e.g. AB12CD"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      maxLength={8}
                    />
                  </div>
                )}
              </div>

              {error && (
                <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "10px 14px", color: "#fca5a5", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>⚠️</span> {error}
                </div>
              )}

              {/* CTA Action button */}
              {tab === "create" ? (
                <button
                  onClick={handleCreate}
                  style={{
                    background: "linear-gradient(135deg, #f59e0b, #d97706)",
                    border: "none",
                    borderRadius: "12px",
                    color: "#ffffff",
                    cursor: "pointer",
                    fontSize: "14px",
                    padding: "14px",
                    fontWeight: "700",
                    transition: "all 0.2s ease",
                    boxShadow: "0 6px 20px rgba(245,158,11,0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(245,158,11,0.35)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(245,158,11,0.25)"; }}
                >
                  ⚡ Start Class Room
                </button>
              ) : (
                <button
                  onClick={handleJoin}
                  style={{
                    background: "linear-gradient(135deg, var(--primary), var(--primary-d))",
                    border: "none",
                    borderRadius: "12px",
                    color: "#ffffff",
                    cursor: "pointer",
                    fontSize: "14px",
                    padding: "14px",
                    fontWeight: "700",
                    transition: "all 0.2s ease",
                    boxShadow: "0 6px 20px rgba(79,142,247,0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(79,142,247,0.35)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(79,142,247,0.25)"; }}
                >
                  Join Classroom →
                </button>
              )}

            </div>
          </div>

        </div>

      </div>

      {/* Modal overlays */}
      {modalState && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "20px", padding: "28px", width: "400px", maxWidth: "90%", boxShadow: "var(--shadow)", display: "flex", flexDirection: "column", gap: "20px" }}>
            <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "#f1f5f9" }}>
              {modalState.type === "CREATE_FOLDER" ? "📁 Create New Folder" : modalState.type === "RENAME_FOLDER" ? "✏️ Rename Folder" : "📂 Move Session to Folder"}
            </h3>

            {modalState.type === "MOVE_SESSION" ? (
              <select autoFocus className="home-input" style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border)", padding: "12px", borderRadius: "10px", color: "var(--text)" }} value={modalInput} onChange={(e) => setModalInput(e.target.value)}>
                <option value="">-- Unorganized --</option>
                {folders.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
              </select>
            ) : (
              <input
                autoFocus
                className="home-input"
                style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border)", padding: "12px", borderRadius: "10px", color: "var(--text)" }}
                placeholder="Folder name..."
                value={modalInput}
                onChange={(e) => setModalInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleModalSubmit(); }}
              />
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button onClick={() => setModalState(null)} className="home-btn" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", color: "#cbd5e1", width: "auto", margin: 0, padding: "10px 20px" }}>Cancel</button>
              <button onClick={handleModalSubmit} className="home-btn primary" style={{ width: "auto", margin: 0, padding: "10px 20px" }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ⏳ Temporary/Permanent Ban Modal overlay */}
      {banModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "20px", padding: "28px", width: "420px", maxWidth: "95%", boxShadow: "0 20px 40px rgba(0,0,0,0.4)", display: "flex", flexDirection: "column", gap: "20px" }}>
            <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "800", color: "#f8fafc", display: "flex", alignItems: "center", gap: "8px" }}>
              ⏳ Ban Teacher: {banModal.teacher.name}
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="home-field" style={{ margin: 0 }}>
                <label style={{ fontSize: "12px", color: "#cbd5e1", fontWeight: "600", marginBottom: "4px" }}>Ban Expiration Date & Time <span style={{ color: "var(--text3)" }}>(Leave empty for Permanent Ban)</span></label>
                <input
                  type="datetime-local"
                  className="home-input"
                  style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border)", padding: "12px", borderRadius: "10px", color: "var(--text)" }}
                  value={banExpiresAt}
                  onChange={(e) => setBanExpiresAt(e.target.value)}
                />
              </div>

              <div className="home-field" style={{ margin: 0 }}>
                <label style={{ fontSize: "12px", color: "#cbd5e1", fontWeight: "600", marginBottom: "4px" }}>Reason for Ban</label>
                <input
                  type="text"
                  className="home-input"
                  style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border)", padding: "12px", borderRadius: "10px", color: "var(--text)" }}
                  placeholder="e.g. Inappropriate content, spamming classes..."
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button onClick={() => setBanModal(null)} className="home-btn" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", color: "#cbd5e1", width: "auto", margin: 0, padding: "10px 20px" }}>Cancel</button>
              <button onClick={handleSaveBan} className="home-btn primary" style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)", border: "none", color: "#fff", width: "auto", margin: 0, padding: "10px 20px" }}>Apply Ban</button>
            </div>
          </div>
        </div>
      )}

      {/* ✏️ Edit Session Modal overlay */}
      {editSessionModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: "20px", padding: "28px", width: "420px", maxWidth: "95%", boxShadow: "0 20px 40px rgba(0,0,0,0.4)", display: "flex", flexDirection: "column", gap: "20px" }}>
            <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "800", color: "#f8fafc", display: "flex", alignItems: "center", gap: "8px" }}>
              ✏️ Edit Session Settings
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="home-field" style={{ margin: 0 }}>
                <label style={{ fontSize: "12px", color: "#cbd5e1", fontWeight: "600", marginBottom: "4px" }}>Session Title</label>
                <input
                  type="text"
                  className="home-input"
                  style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border)", padding: "12px", borderRadius: "10px", color: "var(--text)" }}
                  value={editSessionTitle}
                  onChange={(e) => setEditSessionTitle(e.target.value)}
                />
              </div>

              <div className="home-field" style={{ margin: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                <input
                  type="checkbox"
                  id="editSessionActive"
                  style={{ width: "18px", height: "18px", accentColor: "var(--primary)", cursor: "pointer" }}
                  checked={editSessionActive}
                  onChange={(e) => setEditSessionActive(e.target.checked)}
                />
                <label htmlFor="editSessionActive" style={{ fontSize: "13px", color: "#cbd5e1", fontWeight: "600", cursor: "pointer" }}>Is Session Active / Live?</label>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button onClick={() => setEditSessionModal(null)} className="home-btn" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", color: "#cbd5e1", width: "auto", margin: 0, padding: "10px 20px" }}>Cancel</button>
              <button onClick={handleSaveSessionEdit} className="home-btn primary" style={{ width: "auto", margin: 0, padding: "10px 20px" }}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomeScreen;
