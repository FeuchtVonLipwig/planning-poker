// frontend/src/socket.ts
import { io } from "socket.io-client";

// export const socket = io("http://localhost:3000");


const socketUrl = window.location.origin;

export const socket = io(socketUrl, {
  transports: ["websocket"], // helps on hosted environments
});