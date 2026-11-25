// Socket.IO event types. Keep in step with server/src/sockets/events.ts.
import type { ParticipantRole, SenderRole } from "../types/index.js";

export type ClientToServerEvents = {
  "join-session": (payload: { sessionCode: string; participantCode: string }) => void;
  "send-message": (payload: { content: string }) => void;
  "join-waiting": (payload: { sessionCode: string; participantCode: string }) => void;
  typing: (payload: { isTyping: boolean }) => void; // shows that this participant is typing
};

export type ServerToClientEvents = {
  "session-ready": (payload: {
    sessionCode: string;
    participantCount: number;
    startedAt: string;
  }) => void;
  "join-error": (payload: { reason: string }) => void;
  "new-message": (payload: {
    seq: number;
    sender: string;
    senderRole: SenderRole;
    content: string;
    createdAt: string;
  }) => void;
  "message-failed": (payload: { reason: string }) => void;
  "peer-disconnected": (payload: { role: ParticipantRole }) => void;
  "peer-reconnected": (payload: { role: ParticipantRole }) => void;
  "peer-typing": (payload: { role: ParticipantRole; isTyping: boolean }) => void; // shows that the other participant is typing
  "ai-typing": (payload: { isTyping: boolean }) => void; // shows that Alex is typing
  "session-history": (payload: {
    messages: Array<{
      seq: number;
      sender: string;
      senderRole: SenderRole;
      content: string;
      createdAt: string;
    }>;
    startedAt?: string | null; // server time, so every screen shows the same timer
    aiName?: string; // the name shown for Alex in this condition (undefined in CTRL)
  }) => void;
  "waiting-update": (payload: { participantsReady: number; expected: number }) => void;
  "both-ready": (payload: { sessionCode: string }) => void;
};

export type SocketData = {
  sessionCode: string;
  sessionId: string;
  participantCode: string;
  role: ParticipantRole;
};
