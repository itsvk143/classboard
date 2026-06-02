// config.js — Centralized API and Socket configuration
const isDev = window.location.port === "3000" || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

// For Vercel deployment:
const prodUrl = (process.env.REACT_APP_BACKEND_URL || window.location.origin).replace(/\/$/, "");

const devHost = window.location.hostname;
export const API_BASE_URL = isDev ? `http://${devHost}:3001` : prodUrl;
export const SOCKET_ENDPOINT = isDev ? `http://${devHost}:3001` : prodUrl;
