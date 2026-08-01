import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

import { initDb } from "./db.js";
import { verifyToken } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import jobRoutes from "./routes/jobs.js";
import applicationRoutes from "./routes/applications.js";
import meRoutes from "./routes/me.js";

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: "3mb" })); // resumes travel as base64 JSON, ~1.4MB for a 1MB PDF

app.use("/api/auth", authRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/me", meRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: CLIENT_ORIGIN } });
app.locals.io = io;

// Authenticate the socket (optional — anonymous visitors can still receive
// public "job:created" broadcasts) and join a private room for this user so
// applicant/status notifications only reach the right person.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token) {
    const payload = verifyToken(token);
    if (payload) socket.userId = payload.sub;
  }
  next();
});

io.on("connection", (socket) => {
  if (socket.userId) {
    socket.join(`user:${socket.userId}`);
  }
});

initDb().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Quick Apply backend listening on http://localhost:${PORT}`);
  });
});
