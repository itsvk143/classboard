import "./App.css";
import { Routes, Route } from "react-router-dom";
import HomeScreen from "./views/HomeScreen";
import ClassroomScreen from "./views/ClassroomScreen";
import SessionHistory from "./views/SessionHistory";
import SessionReplay from "./views/SessionReplay";

function App() {
  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/classroom" element={<ClassroomScreen />} />
        <Route path="/history" element={<SessionHistory />} />
        <Route path="/replay/:code" element={<SessionReplay />} />
      </Routes>
    </div>
  );
}

export default App;
