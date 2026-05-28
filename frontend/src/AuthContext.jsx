/**
 * AuthContext.jsx — Global authentication state for ClassBoard
 *
 * Supports two login modes:
 *  1. Google OAuth — when REACT_APP_GOOGLE_CLIENT_ID is configured (production)
 *  2. Demo/fallback — name + email login via /api/auth/demo  (no Google Client ID)
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { API_BASE_URL } from "./config";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [token,   setToken]   = useState(() => localStorage.getItem("cb_token") || null);
  const [loading, setLoading] = useState(true);

  // ── Restore session on mount ────────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem("cb_token");
    if (!stored) { setLoading(false); return; }

    fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(({ user: u }) => { setUser(u); setToken(stored); })
      .catch(() => {
        localStorage.removeItem("cb_token");
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Login via Google credential ─────────────────────────────────────────────
  const login = useCallback(async (credential) => {
    const res = await fetch(`${API_BASE_URL}/api/auth/google`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ credential }),
    });
    if (!res.ok) throw new Error("Google login failed");
    const { token: t, user: u } = await res.json();
    localStorage.setItem("cb_token", t);
    setToken(t);
    setUser(u);
    return u;
  }, []);

  // ── Demo/fallback login — name + email (no Google verification) ─────────────
  // Used when REACT_APP_GOOGLE_CLIENT_ID is not configured yet.
  const loginDemo = useCallback(async (name, email) => {
    const res = await fetch(`${API_BASE_URL}/api/auth/demo`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name, email }),
    });
    if (!res.ok) throw new Error("Login failed");
    const { token: t, user: u } = await res.json();
    localStorage.setItem("cb_token", t);
    setToken(t);
    setUser(u);
    return u;
  }, []);

  // ── Login with pre-issued token (redirect OAuth flow) ──────────────────────
  const loginWithToken = useCallback((t, u) => {
    localStorage.setItem("cb_token", t);
    setToken(t);
    setUser(u);
  }, []);

  // ── Logout ──────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    localStorage.removeItem("cb_token");
    localStorage.removeItem("classboard_session");
    setToken(null);
    setUser(null);
  }, []);

  // ── Authenticated fetch helper ──────────────────────────────────────────────
  const authFetch = useCallback((url, opts = {}) => {
    const headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
    return fetch(url, { ...opts, headers });
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, loginWithToken, loginDemo, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
