/**
 * LoginScreen.jsx — Google OAuth sign-in page
 * Teachers log in with Google; students can join via session code without an account.
 */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";

export default function LoginScreen() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const [guestName, setGuestName] = useState("");
  const [guestCode, setGuestCode] = useState("");
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);

  // ── Google sign-in (teachers / admins) ─────────────────────────────────────
  const handleGoogleSuccess = async (credentialResponse) => {
    setLoading(true);
    setError("");
    try {
      await login(credentialResponse.credential);
      navigate("/");
    } catch {
      setError("Google sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Guest join (students — no Google account required) ─────────────────────
  const handleGuestJoin = () => {
    if (!guestName.trim()) { setError("Please enter your name."); return; }
    if (!guestCode.trim()) { setError("Please enter the session code your teacher shared."); return; }
    setError("");
    navigate("/classroom", {
      state: { action: "join", name: guestName.trim(), email: "", code: guestCode.trim().toUpperCase(), isTeacher: false },
    });
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #0d1117 0%, #0f2027 50%, #161b22 100%)",
      fontFamily: "'Inter', sans-serif", padding: "24px",
    }}>
      <div style={{ width: "100%", maxWidth: 420 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🖊️</div>
          <h1 style={{ color: "#e2e8f0", fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>
            ClassBoard
          </h1>
          <p style={{ color: "#64748b", fontSize: 14, marginTop: 8, marginBottom: 0 }}>
            Real-time collaborative whiteboard for online classes
          </p>
        </div>

        {/* Teacher card */}
        <div style={{
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16, padding: 28, marginBottom: 20,
          backdropFilter: "blur(12px)",
        }}>
          <h2 style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>
            👩‍🏫 Teacher / Admin Login
          </h2>
          <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 20px" }}>
            Sign in with Google to create and manage your classes.
          </p>

          {loading ? (
            <div style={{ textAlign: "center", color: "#64748b", padding: "12px 0" }}>Signing in…</div>
          ) : (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError("Google sign-in failed.")}
                useOneTap={false}
                theme="filled_black"
                shape="pill"
                text="signin_with"
                locale="en"
              />
            </div>
          )}
        </div>

        {/* Student card */}
        <div style={{
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16, padding: 28,
          backdropFilter: "blur(12px)",
        }}>
          <h2 style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>
            🎓 Join as Student
          </h2>
          <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 16px" }}>
            Enter the session code your teacher shared. No account needed.
          </p>

          <input
            placeholder="Your name"
            value={guestName}
            onChange={e => setGuestName(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Session code (e.g. ABC123)"
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
          <p style={{ color: "#f87171", textAlign: "center", fontSize: 13, marginTop: 16 }}>
            {error}
          </p>
        )}

        <p style={{ color: "#334155", fontSize: 11, textAlign: "center", marginTop: 24 }}>
          ClassBoard — Secure collaborative learning
        </p>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10, padding: "12px 14px",
  color: "#e2e8f0", fontSize: 14, outline: "none",
  fontFamily: "inherit",
};

const joinBtnStyle = {
  width: "100%", marginTop: 14,
  padding: "13px 0", borderRadius: 10,
  background: "linear-gradient(135deg, #4f8ef7, #7c3aed)",
  border: "none", color: "#fff",
  fontSize: 15, fontWeight: 700, cursor: "pointer",
  letterSpacing: 0.3,
  transition: "opacity 0.2s",
};
