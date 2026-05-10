// config.js — Centralized API and Socket configuration
const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

// If in production and served by the backend, we use relative paths.
// If in production but hosted separately (e.g. Vercel), we'd need the Railway URL.
export const API_BASE_URL = isDev ? "http://localhost:3001" : window.location.origin;
export const SOCKET_ENDPOINT = isDev ? "http://localhost:3001" : window.location.origin;
