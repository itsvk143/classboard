import React, { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import { Buffer } from "buffer";
import PlayerCard from "../components/PlayerCard";
import WordBar from "../components/WordBar";
import AdminPanel from "../components/AdminPanel";
import { wordsArray, getWordsArrayLength } from "../components/Words";
import { useNavigate, useLocation } from "react-router-dom";
import { SOCKET_ENDPOINT } from "../config";
import { getStroke } from "perfect-freehand";

const ENDPOINT = SOCKET_ENDPOINT;

const drawStroke = (ctx, strokePoints, color) => {
  if (!strokePoints || strokePoints.length === 0) return;
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.moveTo(strokePoints[0][0], strokePoints[0][1]);
  for (let i = 1; i < strokePoints.length; i++) {
    const nextPoint = strokePoints[(i + 1) % strokePoints.length];
    const midX = (strokePoints[i][0] + nextPoint[0]) / 2;
    const midY = (strokePoints[i][1] + nextPoint[1]) / 2;
    ctx.quadraticCurveTo(strokePoints[i][0], strokePoints[i][1], midX, midY);
  }
  ctx.closePath();
  ctx.fill();
};


function PlayScreen() {
  const canvasRef = useRef(null);
  const [isPainting, setIsPainting] = useState(false);
  const [mousePosition, setMousePosition] = useState(undefined);
  const [color, setColor] = useState("#000000");
  const [startPoint, setStartPoint] = useState(null);
  const [lines, setLines] = useState([]);
  const [straightLineMode, setStraightLineMode] = useState(false);
  const [radius, setRadius] = useState(5);
  const [isEraser, setIsEraser] = useState(false);
  const [context, setContext] = useState(null);
  const [inputMessage, setInputMessage] = useState("");
  const [allChats, setAllChats] = useState([]);
  const [allPlayers, setAllPlayer] = useState([]);
  const [socket, setSocket] = useState(null);
  const [currentUserDrawing, setCurrentUserDrawing] = useState(false);
  const [gameStarted, setgameStarted] = useState(false);
  const [playerDrawing, setPlayerDrawing] = useState(null);
  const [showWords, setShowWords] = useState(false);
  const [words, setWords] = useState(["car", "bike", "cycle"]);
  const [selectedWord, setSelectedWord] = useState(null);
  const [showClock, setShowClock] = useState(false);
  const [wordLen, setWordLen] = useState(0);
  const [guessedWord, setGuessedWord] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [adminBroadcast, setAdminBroadcast] = useState("");

  const currentPointsRef = useRef([]);
  const canvasSnapshotRef = useRef(null);

  const navigate = useNavigate();
  const location = useLocation();
  const userDataRecieved = location.state || {};

  // ── Init socket ───────────────────────────────────────────────────────────
  useEffect(() => {
    let us = localStorage.getItem("username");
    const adminFlag = localStorage.getItem("isAdmin") === "true";
    setIsAdmin(userDataRecieved.isAdmin || adminFlag);

    if (!us || !userDataRecieved.username || !userDataRecieved.avatar) {
      navigate("/");
      return;
    }

    const newSocket = io(ENDPOINT);
    setSocket(newSocket);

    window.onbeforeunload = () => localStorage.removeItem("username");

    return () => {
      if (newSocket) newSocket.disconnect();
      localStorage.removeItem("username");
    };
  }, []);

  // ── Canvas setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    setContext(ctx);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineWidth = radius;
    ctx.strokeStyle = color;
    setContext(ctx);
  }, [color, radius]);

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    socket.on("updated-players", (updatedplayers) => {
      setAllPlayer(updatedplayers);
    });

    socket.on("send-user-data", () => {
      socket.emit("recieve-user-data", {
        username: userDataRecieved.username,
        avatar: userDataRecieved.avatar,
        email: userDataRecieved.email || localStorage.getItem("email") || "",
      });
    });

    socket.on("admin-confirmed", () => {
      setIsAdmin(true);
    });

    socket.on("you-were-kicked", () => {
      setKicked(true);
      setTimeout(() => navigate("/"), 3000);
    });

    socket.on("admin-broadcast-message", ({ message }) => {
      setAdminBroadcast(message);
      setTimeout(() => setAdminBroadcast(""), 5000);
    });

    socket.on("admin-force-clear-canvas", () => {
      if (context) {
        context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    });

    socket.on("receiving", async (data) => {
      const base64String = data.split(",")[1];
      const buffer = Buffer.from(base64String, "base64");
      const byteArray = new Uint8Array(buffer);
      const blob = new Blob([byteArray], { type: "image/png" });
      const imageUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        context.drawImage(img, 0, 0);
      };
      img.src = imageUrl;
    });

    socket.on("game-start", () => setgameStarted(true));
    socket.on("game-already-started", () => setgameStarted(true));
    socket.on("game-stop", () => {
      setgameStarted(false);
      setShowClock(false);
      setCurrentUserDrawing(false);
      setPlayerDrawing(null);
    });

    socket.on("start-turn", (player) => {
      setGuessedWord(false);
      clearCanvasAfterTurn();
      setPlayerDrawing(player);
      setWords(getRandomWords());
      setShowWords(true);
    });

    socket.on("word-len", (wl) => setWordLen(wl));

    socket.on("start-draw", (player) => {
      setShowWords(false);
      setShowClock(true);
      clearCanvasAfterTurn();
      if (player.id === socket.id) setCurrentUserDrawing(true);
    });

    socket.on("all-guessed-correct", () => {
      console.log("all guessed correct");
    });

    socket.on("end-turn", (player) => {
      setGuessedWord(false);
      setPlayerDrawing(null);
      setShowClock(false);
      setSelectedWord(null);
      if (socket.id === player.id) setCurrentUserDrawing(false);
    });

    socket.on("recieve-chat", ({ msg, player, rightGuess, players }) => {
      setAllPlayer(players);
      if (rightGuess) {
        if (player.id === socket.id) {
          setGuessedWord(true);
          setAllChats((prev) => [
            { sender: "you", message: `you guessed the right word! (${msg})`, rightGuess },
            ...prev,
          ]);
        } else {
          setAllChats((prev) => [
            { sender: player.name, message: `${player.name} guessed the word right!`, rightGuess },
            ...prev,
          ]);
        }
      } else {
        if (player.id === socket.id) {
          setAllChats((prev) => [{ sender: "you", message: msg, rightGuess }, ...prev]);
        } else {
          setAllChats((prev) => [{ sender: player.name, message: msg, rightGuess }, ...prev]);
        }
      }
    });

    return () => {
      socket.off("updated-players");
      socket.off("send-user-data");
      socket.off("admin-confirmed");
      socket.off("you-were-kicked");
      socket.off("admin-broadcast-message");
      socket.off("admin-force-clear-canvas");
      socket.off("receiving");
      socket.off("game-start");
      socket.off("game-already-started");
      socket.off("game-stop");
      socket.off("start-turn");
      socket.off("word-len");
      socket.off("start-draw");
      socket.off("all-guessed-correct");
      socket.off("end-turn");
      socket.off("recieve-chat");
    };
  }, [socket, context]);

  // ── Canvas interaction ─────────────────────────────────────────────────────
  const getCoordinates = (event) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const startPaint = (event) => {
    if (!currentUserDrawing) return;
    try { event.currentTarget?.setPointerCapture(event.pointerId); } catch {}
    const coordinates = getCoordinates(event);
    if (coordinates) {
      setIsPainting(true);
      setMousePosition(coordinates);
      if (straightLineMode) {
        setStartPoint(coordinates);
      } else if (!isEraser) {
        currentPointsRef.current = [[coordinates.x, coordinates.y, event.pressure || 0.5]];
        if (context && canvasRef.current) {
          canvasSnapshotRef.current = context.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
    }
  };

  const paint = (event) => {
    if (!isPainting || straightLineMode) return;
    const newMousePosition = getCoordinates(event);
    if (mousePosition && newMousePosition) {
      if (isEraser) {
        eraseLine(newMousePosition);
      } else {
        currentPointsRef.current.push([newMousePosition.x, newMousePosition.y, event.pressure || 0.5]);
        if (canvasSnapshotRef.current && context) {
          context.putImageData(canvasSnapshotRef.current, 0, 0);
        }
        const strokePoints = getStroke(currentPointsRef.current, {
          size: radius,
          thinning: 0.5,
          smoothing: 0.5,
          streamline: 0.5,
        });
        drawStroke(context, strokePoints, color);
        
        const dataURL = canvasRef.current.toDataURL("image/png");
        socket.emit("sending", dataURL);
      }
      setMousePosition(newMousePosition);
    }
  };

  const exitPaint = () => {
    setIsPainting(false);
    setMousePosition(undefined);
    setStartPoint(null);
  };

  const handleMouseUp = (event) => {
    try { event.currentTarget?.releasePointerCapture(event.pointerId); } catch {}
    if (straightLineMode && startPoint) {
      drawStraightLine(event);
    } else if (!isEraser && currentPointsRef.current.length > 0) {
      if (canvasSnapshotRef.current && context) {
        context.putImageData(canvasSnapshotRef.current, 0, 0);
      }
      const strokePoints = getStroke(currentPointsRef.current, {
        size: radius,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
      });
      drawStroke(context, strokePoints, color);
      
      const dataURL = canvasRef.current.toDataURL("image/png");
      socket.emit("sending", dataURL);
      
      setLines([...lines, { points: currentPointsRef.current, color, radius }]);
      currentPointsRef.current = [];
    }
    exitPaint();
  };

  const drawStraightLine = (event) => {
    if (straightLineMode && startPoint && context) {
      const endPoint = getCoordinates(event);
      context.strokeStyle = color;
      context.lineWidth = radius;
      context.beginPath();
      context.moveTo(startPoint.x, startPoint.y);
      context.lineTo(endPoint.x, endPoint.y);
      context.stroke();
      const dataURL = canvasRef.current.toDataURL("image/png");
      socket.emit("sending", dataURL);
      setStartPoint(null);
    }
  };

  const eraseLine = (position) => {
    if (!context || !canvasRef.current) return;
    const imageData = context.getImageData(
      position.x - radius, position.y - radius,
      2 * radius, 2 * radius
    );
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) data[i + 3] = 0;
    context.putImageData(imageData, position.x - radius, position.y - radius);
    const dataURL = canvasRef.current.toDataURL("image/png");
    socket.emit("sending", dataURL);
  };

  const fillCanvas = async () => {
    if (!currentUserDrawing) return;
    context.fillStyle = color;
    context.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    const dataURL = await canvasRef.current.toDataURL("image/png");
    socket.emit("sending", dataURL);
  };

  const clearCanvas = async () => {
    if (!currentUserDrawing) return;
    context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setLines([]);
    const dataURL = await canvasRef.current.toDataURL("image/png");
    socket.emit("sending", dataURL);
  };

  const clearCanvasAfterTurn = () => {
    if (context)
      context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const handleChangeText = (e) => setInputMessage(e.target.value);

  const handleSubmitForm = (e) => {
    e.preventDefault();
    if (!inputMessage) return;
    socket.emit("sending-chat", inputMessage.toLocaleLowerCase());
    setInputMessage("");
  };

  const handleWorSelect = (w) => {
    setShowWords(false);
    setSelectedWord(w);
    socket.emit("word-select", w);
    setWords([]);
  };

  const getRandomWords = () => {
    let lengthWordArray = getWordsArrayLength();
    let newWordsArray = [];
    let prevIndex = -1;
    for (let i = 0; i < 3; i++) {
      let newIndex = Math.floor(Math.random() * lengthWordArray);
      while (newIndex === prevIndex)
        newIndex = Math.floor(Math.random() * lengthWordArray);
      newWordsArray.push(wordsArray[newIndex]);
      prevIndex = newIndex;
    }
    return newWordsArray;
  };

  const basicColors = [
    "#000000", "#FF0000", "#00FF00", "#0000FF",
    "#FFFF00", "#FF00FF", "#00FFFF", "#C0C0C0",
    "#808080", "#FFFFFF",
  ];

  // ── Kicked screen ─────────────────────────────────────────────────────────
  if (kicked) {
    return (
      <div
        style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100vh",
          background: "linear-gradient(135deg,#1a1a2e,#16213e)",
          color: "#fff", fontFamily: "Comic Sans MS",
        }}
      >
        <div style={{ fontSize: "64px", marginBottom: "16px" }}>🚫</div>
        <h2 style={{ color: "#e94560" }}>You were kicked by the Admin</h2>
        <p style={{ opacity: 0.7 }}>Redirecting to home...</p>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen">
      {/* ── Admin Broadcast Banner ── */}
      {adminBroadcast && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, right: 0, zIndex: 10000,
            background: "linear-gradient(90deg,#e94560,#c23152)",
            color: "#fff", textAlign: "center",
            padding: "12px", fontWeight: "700",
            fontFamily: "Comic Sans MS", fontSize: "16px",
            boxShadow: "0 4px 20px rgba(233,69,96,0.6)",
            animation: "slideDown 0.3s ease",
          }}
        >
          📢 Admin: {adminBroadcast}
        </div>
      )}

      {/* ── Admin Panel (only for admin) ── */}
      {isAdmin && socket && (
        <AdminPanel socket={socket} allPlayers={allPlayers} />
      )}

      <div className="w-full h-full flex flex-col justify-center items-center gap-4">
        <div>
          <WordBar
            showClock={showClock}
            wordLen={wordLen}
            gameStarted={gameStarted}
            showWords={showWords}
            currentUserDrawing={currentUserDrawing}
            selectedWord={selectedWord}
          />
        </div>

        {/* Admin crown badge */}
        {isAdmin && (
          <div
            style={{
              position: "fixed", top: "10px", left: "10px",
              background: "linear-gradient(135deg,#e94560,#c23152)",
              color: "#fff", padding: "6px 14px", borderRadius: "20px",
              fontFamily: "Comic Sans MS", fontWeight: "700",
              fontSize: "13px", zIndex: 100,
              boxShadow: "0 4px 15px rgba(233,69,96,0.5)",
            }}
          >
            👑 Admin
          </div>
        )}

        <div className="w-full flex justify-center items-center gap-10">
          {/* Players list */}
          <div className="w-[300px] h-[540px] border border-black bg-white text-black">
            {allPlayers &&
              allPlayers.map((pl, idx) => (
                <PlayerCard
                  key={idx}
                  pl={pl}
                  curruser={pl.id === socket?.id}
                  playerDrawing={playerDrawing}
                />
              ))}
          </div>

          {/* Canvas */}
          <div className="w-[680px] h-[540px]">
            <canvas
              ref={canvasRef}
              width={680}
              height={540}
              onPointerDown={startPaint}
              onPointerMove={paint}
              onPointerUp={handleMouseUp}
              onPointerLeave={exitPaint}
              className={`${!currentUserDrawing ? "cursor-not-allowed" : ""}`}
              style={{ border: "1px solid #000", backgroundColor: "white" }}
            />
            <div>
              {showWords && playerDrawing && playerDrawing.id === socket?.id && (
                <div className="absolute top-0 left-0 h-full w-full flex justify-center gap-10 items-center z-10 bg-white bg-opacity-80">
                  {words.map((w, idx) => (
                    <div
                      onClick={() => handleWorSelect(w)}
                      key={idx}
                      className="text-black text-center w-36 h-7 border-2 rounded-md border-black"
                    >
                      {w}
                    </div>
                  ))}
                </div>
              )}
              {showWords && playerDrawing && playerDrawing.id !== socket?.id && (
                <div className="text-black absolute h-full w-full top-0 left-0 flex justify-center items-center z-10 bg-white bg-opacity-80">
                  {`${playerDrawing.name} is choosing a word`}
                </div>
              )}
            </div>
          </div>

          {/* Chat panel */}
          <div className="w-[300px] h-[540px] border border-black flex flex-col-reverse rounded-b-lg p-1">
            <form onSubmit={handleSubmitForm}>
              <input
                value={inputMessage}
                placeholder="Type your guess here"
                className={`min-w-full active max-w-full text-black flex flex-wrap px-6 py-2 rounded-lg font-medium bg-sky-50 bg-opacity-40 border border-blue-300 placeholder-gray-400 text-md focus:outline-none focus:border-blue-400 focus:bg-white focus:ring-0 focus:shadow-[0_0px_10px_2px_#bfdbfe] ${
                  currentUserDrawing || showWords || !gameStarted ? "cursor-not-allowed" : ""
                }`}
                onChange={handleChangeText}
                disabled={currentUserDrawing || showWords || !gameStarted || guessedWord}
              />
            </form>
            {allChats &&
              allChats.length > 0 &&
              allChats.map((chat, idx) => (
                <p
                  className={`${chat.rightGuess ? "bg-green-200 text-green-600" : ""}`}
                  key={idx}
                >
                  {chat.rightGuess ? chat.message : `${chat.sender}: ${chat.message}`}
                </p>
              ))}
          </div>
        </div>

        {/* Drawing tools */}
        {currentUserDrawing && (
          <>
            <div style={{ display: "flex", justifyContent: "center", marginTop: "10px" }}>
              {basicColors.map((c, index) => (
                <button
                  key={index}
                  style={{
                    backgroundColor: c, width: "40px", height: "40px",
                    margin: "0 5px", border: "2px solid #333", borderRadius: "10px",
                    cursor: "pointer", outline: "none",
                    boxShadow: "3px 3px 5px rgba(0,0,0,0.1)",
                    transition: "transform 0.3s",
                  }}
                  onClick={() => setColor(c)}
                  onMouseEnter={(e) => (e.target.style.borderColor = "#FFA500")}
                  onMouseLeave={(e) => (e.target.style.borderColor = "#333")}
                  className="zoom-btn"
                />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginTop: "10px" }}>
              {[
                { label: isEraser ? "Draw" : "Eraser", onClick: () => setIsEraser(!isEraser) },
                {
                  label: straightLineMode ? "Disable Straight Line" : "Enable Straight Line",
                  onClick: () => setStraightLineMode(!straightLineMode),
                },
                { label: "Fill Canvas", onClick: fillCanvas },
              ].map((btn, i) => (
                <button
                  key={i}
                  className="zoom-btn"
                  style={{
                    backgroundColor: "black", padding: "8px 20px", margin: "0 10px",
                    border: "2px solid black", borderRadius: "10px",
                    fontFamily: "Comic Sans MS", fontSize: "18px",
                    fontWeight: "bold", color: "white", cursor: "pointer",
                  }}
                  onClick={btn.onClick}
                >
                  {btn.label}
                </button>
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => { if (e.target.value !== color) setColor(e.target.value); }}
                style={{ marginLeft: "10px", marginRight: "10px" }}
              />
              <label>Radius:</label>
              <input
                type="range" min="1" max="100" value={radius}
                onChange={(e) => setRadius(parseInt(e.target.value))}
                style={{ marginLeft: "5px", marginRight: "10px" }}
              />
              <button
                className="zoom-btn"
                style={{
                  padding: "8px 20px", margin: "0 10px",
                  border: "2px solid black", borderRadius: "10px",
                  fontFamily: "Comic Sans MS", fontSize: "18px",
                  fontWeight: "bold", color: "white", cursor: "pointer",
                }}
                onClick={clearCanvas}
              >
                Clear
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default PlayScreen;
