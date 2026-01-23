import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

// Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Express app
const app = express();
const httpServer = createServer(app);

// Socket.IO
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// In-memory room storage
const rooms = {};

// Helpers
function getPublicRoomsList() {
  return Object.entries(rooms)
    .filter(([_, room]) => room.public === true)
    .map(([roomId, room]) => ({
      roomId,
      users: room.users?.length || 0
    }))
    .sort((a, b) => a.roomId.localeCompare(b.roomId));
}

function broadcastPublicRooms() {
  io.emit("public-rooms-updated", getPublicRoomsList());
}

function emitUsers(roomId) {
  io.to(roomId).emit("users-updated", rooms[roomId].users);
}

function emitVotes(roomId) {
  io.to(roomId).emit("votes-updated", rooms[roomId].votes);
}

function emitCheaters(roomId) {
  io.to(roomId).emit("cheaters-updated", rooms[roomId].cheaters || {});
}

// Generate reveal order with random delays for synchronized card flips
function generateRevealOrder(room) {
  const voterIds = Object.keys(room.votes || {});
  // Shuffle array using Fisher-Yates
  for (let i = voterIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [voterIds[i], voterIds[j]] = [voterIds[j], voterIds[i]];
  }
  // Assign sequential delays (0ms, 200ms, 400ms, etc.) for smooth staggered reveal
  return voterIds.map((id, index) => ({
    id,
    delay: index * 200 + Math.floor(Math.random() * 100) // staggered with small random variance
  }));
}

// auto-reveal helper (server-side, consistent for everyone)
function maybeAutoReveal(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (!room.autoReveal) return;
  if (room.revealed) return;

  const activeUsers = (room.users || []).filter(u => !u.spectator);
  if (activeUsers.length === 0) return;

  const allVoted = activeUsers.every(u => room.votes?.[u.id] !== undefined);
  if (!allVoted) return;

  if (Object.keys(room.votes || {}).length === 0) return;

  room.revealed = true;
  room.cheaters = {}; // new reveal round

  const revealOrder = generateRevealOrder(room);
  io.to(roomId).emit("revealed", { revealOrder });
  emitCheaters(roomId);
}

function emitRoomSettings(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit("room-settings-updated", {
    autoReveal: !!room.autoReveal,
    tShirtMode: !!room.tShirtMode
  });
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("get-public-rooms", () => {
    socket.emit("public-rooms-updated", getPublicRoomsList());
  });

  // --- Create Room ---
  socket.on("create-room", ({ roomCode, name, isPrivate, autoReveal, tShirtMode }) => {
    const roomId = roomCode || Math.random().toString(36).substring(2, 8);

    if (rooms[roomId]) {
      socket.emit("error", "Room code already exists");
      return;
    }

    rooms[roomId] = {
      users: [],
      votes: {},
      revealed: false,
      public: !isPrivate,
      autoReveal: !!autoReveal,
      tShirtMode: !!tShirtMode,
      cheaters: {}
    };

    socket.join(roomId);
    rooms[roomId].users.push({ id: socket.id, name, spectator: false });

    socket.emit("room-created", roomId);
    emitUsers(roomId);
    emitVotes(roomId);
    emitCheaters(roomId);

    emitRoomSettings(roomId);
    broadcastPublicRooms();
  });

  // --- Join Room ---
  socket.on("join-room", ({ roomId, name }) => {
    if (!rooms[roomId]) return socket.emit("error", "Room not found");

    socket.join(roomId);

    rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, name, spectator: false });

    emitUsers(roomId);
    emitVotes(roomId);
    emitCheaters(roomId);

    emitRoomSettings(roomId);
    broadcastPublicRooms();
  });

  // --- Join-or-create via URL ---
  socket.on("join-or-create-room", ({ roomId, name, autoReveal, tShirtMode, isPrivate, isPublic }) => {
    if (!roomId || !String(roomId).trim()) {
      socket.emit("error", "Room not found");
      return;
    }

    const id = String(roomId).trim();

    if (!rooms[id]) {
      const makePrivate = !!isPrivate;
      const makePublic = !!isPublic;

      const isRoomPublic = makePrivate ? false : true;

      rooms[id] = {
        users: [],
        votes: {},
        revealed: false,
        public: isRoomPublic,
        autoReveal: !!autoReveal,
        tShirtMode: !!tShirtMode,
        cheaters: {}
      };
    }

    socket.join(id);

    rooms[id].users = rooms[id].users.filter(u => u.id !== socket.id);
    rooms[id].users.push({ id: socket.id, name, spectator: false });

    emitUsers(id);
    emitVotes(id);
    emitCheaters(id);

    emitRoomSettings(id);
    broadcastPublicRooms();
  });

  // update room autoReveal setting
  socket.on("set-auto-reveal", ({ roomId, autoReveal }) => {
    if (!rooms[roomId]) return;

    rooms[roomId].autoReveal = !!autoReveal;
    emitRoomSettings(roomId);

    maybeAutoReveal(roomId);
  });

  // ✅ UPDATED: update room tShirtMode setting + reset current round
  socket.on("set-tshirt-mode", ({ roomId, tShirtMode }) => {
    if (!rooms[roomId]) return;

    const room = rooms[roomId];
    room.tShirtMode = !!tShirtMode;

    // Reset current round so votes never mix between modes
    room.votes = {};
    room.revealed = false;
    room.cheaters = {};

    // Inform clients
    io.to(roomId).emit("reset");
    emitVotes(roomId);
    emitCheaters(roomId);
    emitRoomSettings(roomId);
  });

  // --- Toggle spectator ---
  socket.on("set-spectator", ({ roomId, spectator }) => {
    if (!rooms[roomId]) return;

    const user = rooms[roomId].users.find(u => u.id === socket.id);
    if (!user) return;

    user.spectator = !!spectator;

    if (user.spectator) {
      if (rooms[roomId].votes[socket.id] !== undefined) delete rooms[roomId].votes[socket.id];
      if (rooms[roomId].cheaters?.[socket.id]) delete rooms[roomId].cheaters[socket.id];
    }

    emitUsers(roomId);
    emitVotes(roomId);
    emitCheaters(roomId);

    maybeAutoReveal(roomId);
  });

  // --- Vote ---
  socket.on("vote", ({ roomId, value }) => {
    if (!rooms[roomId]) return;

    const room = rooms[roomId];
    const user = room.users.find(u => u.id === socket.id);
    if (!user) return;

    if (user.spectator) return;

    const previous = room.votes[socket.id];

    if (room.revealed === true) {
      if (previous === undefined || previous !== value) {
        room.cheaters[socket.id] = true;
      }
    }

    room.votes[socket.id] = value;

    emitVotes(roomId);
    emitCheaters(roomId);

    maybeAutoReveal(roomId);
  });

  // --- Reveal Votes ---
  socket.on("reveal", (roomId) => {
    if (!rooms[roomId]) return;
    const room = rooms[roomId];
    room.revealed = true;
    room.cheaters = {};

    const revealOrder = generateRevealOrder(room);
    io.to(roomId).emit("revealed", { revealOrder });
    emitCheaters(roomId);
  });

  // --- Reset Votes ---
  socket.on("reset", (roomId) => {
    if (!rooms[roomId]) return;

    rooms[roomId].votes = {};
    rooms[roomId].revealed = false;
    rooms[roomId].cheaters = {};

    io.to(roomId).emit("reset");
    emitVotes(roomId);
    emitCheaters(roomId);
  });

  // --- Leave Room ---
  socket.on("leave-room", ({ roomId }) => {
    if (!rooms[roomId]) return;

    const room = rooms[roomId];

    socket.leave(roomId);

    room.users = (room.users || []).filter(u => u.id !== socket.id);

    if (room.votes?.[socket.id] !== undefined) delete room.votes[socket.id];
    if (room.cheaters?.[socket.id]) delete room.cheaters[socket.id];

    if (room.users.length === 0) {
      room.votes = {};
      room.revealed = false;
      room.cheaters = {};
    } else {
      emitUsers(roomId);
      emitVotes(roomId);
      emitCheaters(roomId);
    }

    broadcastPublicRooms();
  });

  // --- Disconnect ---
  socket.on("disconnect", () => {
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];

      room.users = room.users.filter(u => u.id !== socket.id);
      if (room.votes[socket.id] !== undefined) delete room.votes[socket.id];
      if (room.cheaters?.[socket.id]) delete room.cheaters[socket.id];

      if (room.users.length === 0) {
        delete rooms[roomId];
      } else {
        emitUsers(roomId);
        emitVotes(roomId);
        emitCheaters(roomId);
      }
    }

    broadcastPublicRooms();
    console.log("Client disconnected:", socket.id);
  });
});

// ---------------------------
// Static frontend + caching fix
// ---------------------------
const distPath = path.join(__dirname, "../frontend/dist");

// 1) Serve static files with proper cache headers:
//    - index.html: never cache (prevents stale HTML after deploy)
//    - /assets/*: cache forever (Vite hashed files)
app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return;
    }

    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  }
}));

// 2) IMPORTANT: if an /assets/* file is missing, return 404.
//    This prevents Express from serving index.html (HTML) for a JS module request.
app.get("/assets/*path", (_req, res) => {
  res.status(404).end();
});

// 3) SPA fallback for real app routes
app.get("*path", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});