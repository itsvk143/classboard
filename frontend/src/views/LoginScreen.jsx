/**
 * LoginScreen.jsx — ClassBoard sign-in page
 *
 * Teacher section:
 *  • "Sign in with Google" button → standard OAuth 2.0 redirect flow
 *    (avoids origin_mismatch from the GIS JavaScript library)
 *  • Falls back to name + email form when no Google Client ID configured
 *
 * Student section:
 *  • Name + session code → joins classroom directly (no account needed)
 */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

export default function LoginScreen() {
  const { loginDemo } = useAuth();
  const navigate = useNavigate();

  // Teacher fallback form
  const [teacherName,  setTeacherName]  = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");

  // Student join form
  const [guestName, setGuestName] = useState("");
  const [guestCode, setGuestCode] = useState("");

  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  // ── Google OAuth 2.0 redirect (no JS origin needed) ─────────────────────────
  const handleGoogleRedirect = async () => {
    setLoading(true);
    setError("");
    try {
      const res  = await fetch(`${API_BASE_URL}/api/auth/google/url`);
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else throw new Error("No URL returned");
    } catch (e) {
      setError("Could not start Google sign-in. Try name/email login below.");
      setLoading(false);
    }
  };

  // ── Demo / fallback teacher login ───────────────────────────────────────────
  const handleDemoLogin = async () => {
    if (!teacherName.trim())  { setError("Please enter your name."); return; }
    if (!teacherEmail.trim()) { setError("Please enter your email."); return; }
    if (!teacherEmail.includes("@")) { setError("Please enter a valid email."); return; }
    setLoading(true);
    setError("");
    try {
      await loginDemo(teacherName.trim(), teacherEmail.trim().toLowerCase());
      navigate("/");
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Student join ────────────────────────────────────────────────────────────
  const handleGuestJoin = () => {
    if (!guestName.trim()) { setError("Please enter your name."); return; }
    if (!guestCode.trim()) { setError("Please enter the session code."); return; }
    setError("");
    navigate("/classroom", {
      state: {
        action: "join",
        name:   guestName.trim(),
        email:  "",
        code:   guestCode.trim().toUpperCase(),
        isTeacher: false,
      },
    });
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #0d1117 0%, #0f2027 50%, #161b22 100%)",
      fontFamily: "'Inter', sans-serif", padding: "24px",
    }}>
      <div style={{ width: "100%", maxWidth: 440 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 52, marginBottom: 10 }}>🖊️</div>
          <h1 style={{ color: "#e2e8f0", fontSize: 30, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>
            ClassBoard
          </h1>
          <p style={{ color: "#64748b", fontSize: 14, marginTop: 8, marginBottom: 0 }}>
            Real-time collaborative whiteboard for online classes
          </p>
        </div>

        {/* ── Teacher / Admin Login ─────────────────────────────────────────── */}
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>👩‍🏫 Teacher / Admin Login</h2>
          <p style={cardSubStyle}>Sign in with Google to create and manage your classes.</p>

          {loading ? (
            <div style={{ textAlign: "center", color: "#64748b", padding: "16px 0" }}>Signing in…</div>
          ) : GOOGLE_CLIENT_ID ? (
            /* Standard OAuth 2.0 redirect button — no origin_mismatch issues */
            <button onClick={handleGoogleRedirect} style={googleBtnStyle}>
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google"
                style={{ width: 20, height: 20 }}
              />
              Sign in with Google
            </button>
          ) : (
            /* Fallback: name + email when no Google Client ID */
            <>
              <div style={{
                background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
                borderRadius: 8, padding: "8px 12px", marginBottom: 14,
                fontSize: 12, color: "#fbbf24",
              }}>
                ⚠️ Google OAuth not configured — using name/email login
              </div>
              <input
                placeholder="Your name"
                value={teacherName}
                onChange={e => setTeacherName(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder="your@email.com"
                type="email"
                value={teacherEmail}
                onChange={e => setTeacherEmail(e.target.value)}
                style={{ ...inputStyle, marginTop: 10 }}
                onKeyDown={e => e.key === "Enter" && handleDemoLogin()}
              />
              <button
                onClick={handleDemoLogin}
                style={{ ...joinBtnStyle, marginTop: 14, background: "linear-gradient(135deg, #4f8ef7, #7c3aed)" }}
              >
                Sign In as Teacher →
              </button>
            </>
          )}
        </div>

        {/* ── Student join ──────────────────────────────────────────────────── */}
        <div style={{ ...cardStyle, marginTop: 0 }}>
          <h2 style={cardTitleStyle}>🎓 Join as Student</h2>
          <p style={cardSubStyle}>
            Enter the session code your teacher shared. No account needed.
          </p>

          <input
            placeholder="Your name"
            value={guestName}
            onChange={e => setGuestName(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Session code  (e.g. ABC123)"
            value={guestCode}
            onChange={e => setGuestCode(e.target.value.toUpperCase())}
            style={{ ...inputStyle, marginTop: 10, letterSpacing: 3, fontWeight: 700 }}
            onKeyDown={e => e.key === "Enter" && handleGuestJoin()}
          />
          <button onClick={handleGuestJoin} style={joinBtnStyle}>
            Join Class →
          </button>
        </div>

        {error && (
          <p style={{ color: "#f87171", textAlign: "center", fontSize: 13, marginTop: 14 }}>
            {error}
          </p>
        )}

        <p style={{ color: "#1e293b", fontSize: 11, textAlign: "center", marginTop: 20 }}>
          ClassBoard · Secure collaborative learning
        </p>
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const cardStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16, padding: 28, marginBottom: 16,
  backdropFilter: "blur(12px)",
};

const cardTitleStyle = {
  color: "#e2e8f0", fontSize: 16, fontWeight: 700, margin: "0 0 6px",
};

const cardSubStyle = {
  color: "#64748b", fontSize: 13, margin: "0 0 18px",
};

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10, padding: "12px 14px",
  color: "#e2e8f0", fontSize: 14, outline: "none",
  fontFamily: "inherit",
};

const googleBtnStyle = {
  width: "100%", padding: "12px 0", borderRadius: 10,
  background: "#fff", border: "none", cursor: "pointer",
  fontSize: 15, fontWeight: 600, color: "#1f2937",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
  transition: "box-shadow 0.2s",
};

const joinBtnStyle = {
  width: "100%", marginTop: 14,
  padding: "13px 0", borderRadius: 10,
  background: "linear-gradient(135deg, #22c55e, #16a34a)",
  border: "none", color: "#fff",
  fontSize: 15, fontWeight: 700, cursor: "pointer",
  letterSpacing: 0.3, transition: "opacity 0.2s",
};
