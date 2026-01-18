// frontend/src/socket.ts
import { io } from "socket.io-client";

/**
 * Socket.IO connection
 *
 * - In production: connects to the same origin as the page
 * - In local dev (Vite on :5173): connects to backend on :3000
 */

const isDevServer = import.meta.env.DEV && window.location.port === "5173";
const socketUrl = isDevServer ? "http://localhost:3000" : window.location.origin;

export const socket = io(socketUrl, {
  transports: ["websocket", "polling"],
  withCredentials: true,
});
