import "./App.css";
import { Routes, Route, Navigate } from "react-router-dom";
import { GoogleOAuthProvider }   from "@react-oauth/google";
import { AuthProvider, useAuth } from "./AuthContext";
import LoginScreen               from "./views/LoginScreen";
import HomeScreen                from "./views/HomeScreen";
import ClassroomScreen           from "./views/ClassroomScreen";
import SessionHistory            from "./views/SessionHistory";
import SessionReplay             from "./views/SessionReplay";

// Your Google OAuth Client ID — set REACT_APP_GOOGLE_CLIENT_ID in Vercel environment variables
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

// ── Protected route: requires a logged-in teacher/admin ───────────────────────
function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0d1117", color: "#64748b", fontSize: 14 }}>
      Loading…
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <div className="App">
          <Routes>
            {/* Public */}
            <Route path="/login"    element={<LoginScreen />} />

            {/* Anyone can join a classroom (students join with code, no auth needed) */}
            <Route path="/classroom" element={<ClassroomScreen />} />
            <Route path="/replay/:code" element={<SessionReplay />} />

            {/* Protected — teachers/admins only */}
            <Route path="/" element={
              <PrivateRoute><HomeScreen /></PrivateRoute>
            } />
            <Route path="/history" element={
              <PrivateRoute><SessionHistory /></PrivateRoute>
            } />
          </Routes>
        </div>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}

export default App;
