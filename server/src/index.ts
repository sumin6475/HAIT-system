import express from "express";
import { guardFlagsSummary } from "./lib/guardFlags.js";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { connectDB } from "./db.js";
import { healthRouter } from "./routes/health.js";
import { testRouter } from "./routes/test.js";
import { sessionsRouter } from "./routes/sessions.js";
import participantsRouter from "./routes/participants.js";
import { conditionsRouter } from "./routes/conditions.js";
import { registerSocketHandlers } from "./sockets/index.js";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "./sockets/events.js";

// Allowed CORS origins, comma-separated. When unset, every origin is allowed (for local development).
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : true;

const corsOptions: cors.CorsOptions = {
  origin: corsOrigins,
  credentials: true,
  allowedHeaders: ["Content-Type", "x-admin-token"],
};

async function start() {
  await connectDB();
  const app = express();

  app.use(cors(corsOptions)); //Express HTTP API
  app.use(express.json());
  app.use(healthRouter);
  app.use(testRouter);
  app.use("/api/conditions", conditionsRouter);
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/participants", participantsRouter);

  // HTTP server, so Socket.IO can attach to it.
  const httpServer = http.createServer(app);
  // Socket.IO server.
  const io = new Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
  });
  // Socket.IO connection handlers.
  registerSocketHandlers(io);

  // Listen on the HTTP server (not app.listen), so Socket.IO shares the port.
  httpServer.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
    // A build with a guard switched off announces itself at startup, so nobody
    // runs a comparison session believing it is an ordinary one.
    const guardNotice = guardFlagsSummary();
    if (guardNotice) console.log(guardNotice);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
