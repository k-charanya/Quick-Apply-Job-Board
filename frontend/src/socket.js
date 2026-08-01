import { io } from "socket.io-client";
import { api } from "./api.js";

// A single persistent socket instance. Listeners attached to it (in App.jsx) survive
// reconnects, so login/logout only needs to update the auth token and reconnect —
// not re-attach every handler.
export const socket = io(api.base, {
  autoConnect: false,
  transports: ["websocket", "polling"],
});

export function connectSocket(token) {
  socket.auth = { token: token || undefined };
  if (socket.connected) socket.disconnect();
  socket.connect();
}

export function disconnectSocket() {
  socket.disconnect();
}

