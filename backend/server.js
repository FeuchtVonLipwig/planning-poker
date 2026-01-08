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
// rooms[roomId] = { users: [{id,name}], votes: {}, revealed: false, public: boolean }
const rooms = {};

// Helper: list public rooms
function getPublicRooms() {
  return Object.entries(rooms)
    .filter(([_, r]) => r.public)
    .map(([id, r]) => ({ roomId: id, usersCount: r.users.length }));
}

// Helper: broadcast public rooms
function broadcastPublicRooms() {
  io.emit("public-rooms-updated", getPublicRooms());
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // On connect, send current public rooms
  socket.emit("public-rooms-updated", getPublicRooms());

  // --- Create Room ---
  // Supports:
  // 1) socket.emit("create-room", "myCode")
  // 2) socket.emit("create-room", { roomCode, name, public })
  socket.on("create-room", (payload) => {
    const roomCode =
      typeof payload === "string" ? payload : (payload?.roomCode || "");

    const name =
      typeof payload === "object" && payload?.name ? payload.name : null;

    const isPublic =
      typeof payload === "object" && typeof payload?.public === "boolean"
        ? payload.public
        : false;

    // Use provided code or fallback to random
    const roomId = roomCode || Math.random().toString(36).substring(2, 8);

    if (rooms[roomId]) {
      socket.emit("error", "Room code already exists");
      return;
    }

    rooms[roomId] = { users: [], votes: {}, revealed: false, public: isPublic };

    // IMPORTANT: creator auto-joins
    socket.join(roomId);
    if (name) {
      rooms[roomId].users.push({ id: socket.id, name });
      io.to(roomId).emit("users-updated", rooms[roomId].users);
    }

    socket.emit("room-created", roomId);
    broadcastPublicRooms();
  });

  // --- Join Room ---
  // Behavior:
  // - If room exists -> join it
  // - If room does NOT exist -> create it as PRIVATE and join it
  socket.on("join-room", ({ roomId, name }) => {
    if (!roomId) return socket.emit("error", "Room not found");

    // If missing: create private room (per your requirement)
    if (!rooms[roomId]) {
      rooms[roomId] = { users: [], votes: {}, revealed: false, public: false };
      broadcastPublicRooms(); // (no effect unless public, but harmless)
    }

    socket.join(roomId);

    // prevent duplicate entries for same socket id
    rooms[roomId].users = rooms[roomId].users.filter((u) => u.id !== socket.id);
    rooms[roomId].users.push({ id: socket.id, name });

    io.to(roomId).emit("users-updated", rooms[roomId].users);

    // Optional: if someone joins after reveal/reset, bring them up-to-date
    socket.emit("votes-updated", rooms[roomId].votes);
    if (rooms[roomId].revealed) socket.emit("revealed");
  });

  // --- Vote ---
  socket.on("vote", ({ roomId, value }) => {
    if (!rooms[roomId]) return;
    rooms[roomId].votes[socket.id] = value;
    io.to(roomId).emit("votes-updated", rooms[roomId].votes);
  });

  // --- Reveal Votes ---
  socket.on("reveal", (roomId) => {
    if (!rooms[roomId]) return;
    rooms[roomId].revealed = true;
    io.to(roomId).emit("revealed");
  });

  // --- Reset Votes ---
  socket.on("reset", (roomId) => {
    if (!rooms[roomId]) return;
    rooms[roomId].votes = {};
    rooms[roomId].revealed = false;
    io.to(roomId).emit("reset");
  });

  // --- Disconnect ---
  socket.on("disconnect", () => {
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      room.users = room.users.filter((u) => u.id !== socket.id);

      if (room.users.length === 0) {
        delete rooms[roomId];
        broadcastPublicRooms();
      } else {
        io.to(roomId).emit("users-updated", room.users);
        broadcastPublicRooms();
      }
    }
    console.log("Client disconnected:", socket.id);
  });
});

// Serve frontend static files
const distPath = path.join(__dirname, "../frontend/dist");
app.use(express.static(distPath));

// SPA fallback (so /room/XYZ works)
app.get("*", (_, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
