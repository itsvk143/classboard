/**
 * OAuthCallback.jsx — Handles the redirect from Google OAuth
 *
 * Flow:
 *  1. User clicks "Sign in with Google" on LoginScreen
 *  2. We redirect to Google's OAuth URL (via backend /api/auth/google/url)
 *  3. Google authenticates and redirects back to /api-callback?code=...
 *  4. This page reads ?code=, calls backend /api/auth/google/callback
 *  5. Backend exchanges code for JWT, returns user
 *  6. We store JWT and redirect to dashboard
 */
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Completing sign-in…");

  useEffect(() => {
    const code  = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      setStatus("Google sign-in was cancelled.");
      setTimeout(() => navigate("/login"), 2000);
      return;
    }
    if (!code) {
      setStatus("Invalid callback. Redirecting…");
      setTimeout(() => navigate("/login"), 2000);
      return;
    }

    // Send the code to the backend to exchange for a JWT
    fetch(`${API_BASE_URL}/api/auth/google/callback?code=${encodeURIComponent(code)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        loginWithToken(data.token, data.user);
        navigate("/", { replace: true });
      })
      .catch(err => {
        console.error("OAuth callback failed:", err);
        setStatus("Sign-in failed: " + err.message);
        setTimeout(() => navigate("/login"), 3000);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #0d1117 0%, #0f2027 50%, #161b22 100%)",
      fontFamily: "'Inter', sans-serif", color: "#e2e8f0", gap: 16,
    }}>
      <div style={{ fontSize: 48 }}>🖊️</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{status}</div>
      <div style={{
        width: 40, height: 4, borderRadius: 2,
        background: "linear-gradient(90deg, #4f8ef7, #7c3aed)",
        animation: "pulse 1.5s ease-in-out infinite",
      }} />
    </div>
  );
}
