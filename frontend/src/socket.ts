// frontend/src/socket.ts
import { io } from "socket.io-client";

/**
 * Socket.IO connection
 *
 * - In production (Render): connects to the same origin as the page
 * - In local dev:
 *   - Vite proxy or same-origin setup → also works
 *   - If backend runs separately on :3000, uncomment the DEV override below
 */

// DEV override (only if needed locally)
// const socketUrl = "http://localhost:3000";

const socketUrl = window.location.origin;

export const socket = io(socketUrl, {
  transports: ["websocket", "polling"], // websocket first, polling fallback
  withCredentials: true,
});
