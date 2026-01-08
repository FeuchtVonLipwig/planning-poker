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
// rooms[roomId] = { users: [{id,name,spectator}], votes: {}, revealed: false, public: boolean }
const rooms = {};

function getPublicRooms() {
  return Object.entries(rooms)
    .filter(([_, r]) => r.public)
    .map(([roomId, r]) => ({ roomId, usersCount: r.users.length }));
}

function broadcastPublicRooms() {
  io.emit("public-rooms-updated", getPublicRooms());
}

function emitUsers(roomId) {
  io.to(roomId).emit("users-updated", rooms[roomId].users);
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Send initial public rooms list
  socket.emit("public-rooms-updated", getPublicRooms());

  // CREATE ROOM
  // Accepts:
  //  - "ABC123"
  //  - { roomCode, name, public }
  socket.on("create-room", (payload) => {
    const roomCode =
      typeof payload === "string" ? payload : (payload?.roomCode || "");

    const name =
      typeof payload === "object" && payload?.name ? payload.name : null;

    const isPublic =
      typeof payload === "object" && typeof payload?.public === "boolean"
        ? payload.public
        : false;

    const roomId = roomCode || Math.random().toString(36).substring(2, 8);

    if (rooms[roomId]) {
      socket.emit("error", "Room code already exists");
      return;
    }

    rooms[roomId] = { users: [], votes: {}, revealed: false, public: isPublic };

    // Creator auto-joins (important)
    socket.join(roomId);
    if (name) {
      rooms[roomId].users.push({ id: socket.id, name, spectator: false });
      emitUsers(roomId);
    }

    socket.emit("room-created", roomId);
    broadcastPublicRooms();
  });

  // JOIN ROOM
  // Requirement:
  // - If room exists -> join
  // - If room doesn't exist -> create private room and join
  socket.on("join-room", ({ roomId, name }) => {
    if (!roomId) return socket.emit("error", "Room not found");

    if (!rooms[roomId]) {
      // Create private room
      rooms[roomId] = { users: [], votes: {}, revealed: false, public: false };
      broadcastPublicRooms();
    }

    socket.join(roomId);

    // Prevent duplicates
    rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, name, spectator: false });

    emitUsers(roomId);

    // Sync current state
    socket.emit("votes-updated", rooms[roomId].votes);
    if (rooms[roomId].revealed) socket.emit("revealed");
  });

  // SPECTATOR TOGGLE
  socket.on("set-spectator", ({ roomId, spectator }) => {
    if (!rooms[roomId]) return;

    const user = rooms[roomId].users.find(u => u.id === socket.id);
    if (!user) return;

    user.spectator = !!spectator;
    emitUsers(roomId);
  });

  // VOTE
  socket.on("vote", ({ roomId, value }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].votes[socket.id] = value;
    io.to(roomId).emit("votes-updated", rooms[roomId].votes);
  });

  // REVEAL
  socket.on("reveal", (roomId) => {
    if (!rooms[roomId]) return;
    rooms[roomId].revealed = true;
    io.to(roomId).emit("revealed");
  });

  // RESET
  socket.on("reset", (roomId) => {
    if (!rooms[roomId]) return;
    rooms[roomId].votes = {};
    rooms[roomId].revealed = false;
    io.to(roomId).emit("reset");
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];

      // Remove user + their vote
      room.users = room.users.filter(u => u.id !== socket.id);
      delete room.votes[socket.id];

      if (room.users.length === 0) {
        delete rooms[roomId];
        broadcastPublicRooms();
      } else {
        emitUsers(roomId);
        io.to(roomId).emit("votes-updated", room.votes);
        broadcastPublicRooms();
      }
    }
    console.log("Client disconnected:", socket.id);
  });
});

// Serve frontend static files
const distPath = path.join(__dirname, "../frontend/dist");
app.use(express.static(distPath));

// SPA fallback so /room/XYZ loads the app
app.get("*", (_, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
