import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "../sockets/events.js";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

// On the client the event maps are the other way round:
// - the client listens for ServerToClientEvents
// - the client emits ClientToServerEvents

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: false, // connect only when asked
});
