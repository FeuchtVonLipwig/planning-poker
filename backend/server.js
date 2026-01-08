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

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Client asks for current public rooms list
  socket.on("get-public-rooms", () => {
    socket.emit("public-rooms-updated", getPublicRoomsList());
  });

  // --- Create Room ---
  // CHANGED: expects { isPrivate } and public is default
  socket.on("create-room", ({ roomCode, name, isPrivate }) => {
    const roomId = roomCode || Math.random().toString(36).substring(2, 8);

    if (rooms[roomId]) {
      socket.emit("error", "Room code already exists");
      return;
    }

    rooms[roomId] = {
      users: [],
      votes: {},
      revealed: false,
      public: !isPrivate, // CHANGED
      cheaters: {}
    };

    // auto-join creator
    socket.join(roomId);
    rooms[roomId].users.push({ id: socket.id, name, spectator: false });

    socket.emit("room-created", roomId);
    emitUsers(roomId);
    emitVotes(roomId);
    emitCheaters(roomId);
    broadcastPublicRooms();
  });

  // --- Join Room ---
  socket.on("join-room", ({ roomId, name }) => {
    if (!rooms[roomId]) return socket.emit("error", "Room not found");

    socket.join(roomId);

    // prevent duplicate entries
    rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, name, spectator: false });

    emitUsers(roomId);
    emitVotes(roomId);
    emitCheaters(roomId);
    broadcastPublicRooms();
  });

  // --- Toggle spectator ---
  socket.on("set-spectator", ({ roomId, spectator }) => {
    if (!rooms[roomId]) return;

    const user = rooms[roomId].users.find(u => u.id === socket.id);
    if (!user) return;

    user.spectator = !!spectator;

    // If user becomes spectator, remove their vote + cheater status
    if (user.spectator) {
      if (rooms[roomId].votes[socket.id] !== undefined) delete rooms[roomId].votes[socket.id];
      if (rooms[roomId].cheaters?.[socket.id]) delete rooms[roomId].cheaters[socket.id];
    }

    emitUsers(roomId);
    emitVotes(roomId);
    emitCheaters(roomId);
  });

  // --- Vote ---
  socket.on("vote", ({ roomId, value }) => {
    if (!rooms[roomId]) return;

    const room = rooms[roomId];
    const user = room.users.find(u => u.id === socket.id);
    if (!user) return;

    // spectators cannot vote
    if (user.spectator) return;

    const previous = room.votes[socket.id];

    // if revealed and someone CHANGES an existing vote => cheater
    if (room.revealed === true && previous !== undefined && previous !== value) {
      room.cheaters[socket.id] = true;
    }

    room.votes[socket.id] = value;

    emitVotes(roomId);
    emitCheaters(roomId);
  });

  // --- Reveal Votes ---
  socket.on("reveal", (roomId) => {
    if (!rooms[roomId]) return;
    rooms[roomId].revealed = true;

    // start fresh cheating tracking for this reveal round
    rooms[roomId].cheaters = {};

    io.to(roomId).emit("revealed");
    emitCheaters(roomId);
  });

  // --- Reset Votes ---
  socket.on("reset", (roomId) => {
    if (!rooms[roomId]) return;

    rooms[roomId].votes = {};
    rooms[roomId].revealed = false;

    // reset cheaters on reset
    rooms[roomId].cheaters = {};

    io.to(roomId).emit("reset");
    emitVotes(roomId);
    emitCheaters(roomId);
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

// Serve frontend static files
const distPath = path.join(__dirname, "../frontend/dist");
app.use(express.static(distPath));
app.get("*", (_, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
