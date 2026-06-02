/**
 * AuthContext.jsx — Global authentication state for ClassBoard
 *
 * Supports two login modes:
 *  1. Google OAuth — when REACT_APP_GOOGLE_CLIENT_ID is configured (production)
 *  2. Demo/fallback — name + email login via /api/auth/demo  (no Google Client ID)
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { API_BASE_URL } from "./config";

const safeStorage = {
  getItem: (key) => {
    try { return localStorage.getItem(key); }
    catch (e) { return null; }
  },
  setItem: (key, value) => {
    try { localStorage.setItem(key, value); }
    catch (e) {}
  },
  removeItem: (key) => {
    try { localStorage.removeItem(key); }
    catch (e) {}
  }
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [token,   setToken]   = useState(() => safeStorage.getItem("cb_token") || null);
  const [loading, setLoading] = useState(true);

  // ── Restore session on mount ────────────────────────────────────────────────
  useEffect(() => {
    // ── Case 1: token delivered in URL by backend after OAuth redirect ──────
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("cb_token");
    const authError = params.get("auth_error");

    if (urlToken) {
      // Clean the token from URL immediately
      window.history.replaceState({}, document.title, window.location.pathname);
      safeStorage.setItem("cb_token", urlToken);
      setToken(urlToken);
      // Decode user from JWT (don't need a round-trip to verify here)
      try {
        const payload = JSON.parse(atob(urlToken.split(".")[1]));
        setUser({ googleId: payload.googleId, email: payload.email, name: payload.name, picture: payload.picture, role: payload.role });
      } catch {}
      setLoading(false);
      return;
    }

    if (authError) {
      window.history.replaceState({}, document.title, window.location.pathname);
      console.error("Auth error from OAuth:", authError);
      setLoading(false);
      return;
    }

    // ── Case 2: restore from localStorage ──────────────────────────────────
    const stored = safeStorage.getItem("cb_token");
    if (!stored) { setLoading(false); return; }

    fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(({ user: u }) => { setUser(u); setToken(stored); })
      .catch(() => {
        safeStorage.removeItem("cb_token");
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
    safeStorage.setItem("cb_token", t);
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
    safeStorage.setItem("cb_token", t);
    setToken(t);
    setUser(u);
    return u;
  }, []);

  // ── Login with pre-issued token (redirect OAuth flow) ──────────────────────
  const loginWithToken = useCallback((t, u) => {
    safeStorage.setItem("cb_token", t);
    setToken(t);
    setUser(u);
  }, []);

  // ── Logout ──────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    safeStorage.removeItem("cb_token");
    safeStorage.removeItem("classboard_session");
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
