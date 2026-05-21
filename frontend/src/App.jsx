import "./App.css";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import LoginScreen    from "./views/LoginScreen";
import HomeScreen     from "./views/HomeScreen";
import ClassroomScreen from "./views/ClassroomScreen";
import SessionHistory from "./views/SessionHistory";
import SessionReplay  from "./views/SessionReplay";

// Google Client ID — set REACT_APP_GOOGLE_CLIENT_ID in Vercel env vars
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

// Lazy-import GoogleOAuthProvider only when we actually have a client ID,
// so a missing env var never crashes the whole app.
let GoogleOAuthProvider = null;
if (GOOGLE_CLIENT_ID) {
  try {
    // dynamic require so webpack still tree-shakes when not used
    GoogleOAuthProvider = require("@react-oauth/google").GoogleOAuthProvider;
  } catch { /* package not installed — ignore */ }
}

// ── Protected route: requires a logged-in teacher/admin ──────────────────────
function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0d1117", color: "#64748b", fontSize: 14,
    }}>
      Loading…
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function AppRoutes() {
  return (
    <div className="App">
      <Routes>
        {/* Public routes */}
        <Route path="/login"         element={<LoginScreen />} />
        <Route path="/classroom"     element={<ClassroomScreen />} />
        <Route path="/replay/:code"  element={<SessionReplay />} />

        {/* Protected — teachers/admins only */}
        <Route path="/" element={
          <PrivateRoute><HomeScreen /></PrivateRoute>
        } />
        <Route path="/history" element={
          <PrivateRoute><SessionHistory /></PrivateRoute>
        } />
      </Routes>
    </div>
  );
}

function App() {
  const inner = (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );

  // Only wrap with GoogleOAuthProvider when clientId is available
  if (GoogleOAuthProvider && GOOGLE_CLIENT_ID) {
    return <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{inner}</GoogleOAuthProvider>;
  }
  return inner;
}

export default App;
