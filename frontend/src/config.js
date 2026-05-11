// config.js — Centralized API and Socket configuration
const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

// For Vercel deployment:
// Set REACT_APP_BACKEND_URL in Vercel settings to your Railway URL (e.g., https://your-app.up.railway.app)
const prodUrl = process.env.REACT_APP_BACKEND_URL || window.location.origin;

export const API_BASE_URL = isDev ? "http://localhost:3001" : prodUrl;
export const SOCKET_ENDPOINT = isDev ? "http://localhost:3001" : prodUrl;
