import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { ChatMessage, ParticipantRole } from "@/types";
import type { SenderRole } from "@/types";
import { ROLE_LABEL } from "@/lib/labels";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageInput } from "@/components/chat/MessageInput";
import { Timer } from "@/components/chat/Timer";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { InfoCardPanel } from "@/components/chat/InfoCardPanel";
import { FlaskConical } from "lucide-react";
import { socket } from "@/lib/socket";
import { getParticipantState, type ProfileSlot } from "@/lib/api";
import { DISCUSSION_DURATION_MINUTES, MIN_DISCUSSION_MINUTES } from "@/lib/sessionConfig";

const ChatRoom = () => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Timer based on the server's startedAt (sent with the session history), so a reload does not reset it.
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [myRole, setMyRole] = useState<SenderRole | null>(null);
  const [profile, setProfile] = useState<ProfileSlot | null>(null);
  // The name shown for Alex in this condition (sent with the session history). Read from state when rendering, not stored in each message.
  const [aiName, setAiName] = useState("Alex"); // fallback if the server sends no name
  // The Exit button stays hidden until the minimum discussion time has passed.
  const [canExit, setCanExit] = useState(false);
  // The room never moves on by itself when time runs out; the participant presses Exit. timeUp only changes the notice text.
  const [timeUp, setTimeUp] = useState(false);
  // Roles of the other participants who are typing right now. Updated by peer-typing; cleared when their message arrives or they leave.
  const [typingRoles, setTypingRoles] = useState<ParticipantRole[]>([]);
  const [aiTyping, setAiTyping] = useState(false); // shows that Alex is typing
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to the bottom, also when a typing indicator appears.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingRoles, aiTyping]);

  // Show the Exit button once the minimum discussion time has passed, by the server's startedAt (ticks every second).
  useEffect(() => {
    if (!startTime || canExit) return;
    const MIN_DISCUSSION_MS = MIN_DISCUSSION_MINUTES * 60 * 1000;
    const check = () => {
      if (Date.now() - startTime.getTime() >= MIN_DISCUSSION_MS) setCanExit(true);
    };
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [startTime, canExit]);

  // The participant's own card, as the server says it is. Only this participant's card is shown.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const participantCode =
      params.get("participant") ?? sessionStorage.getItem("participantCode") ?? undefined;

    if (!participantCode) return;

    getParticipantState(participantCode)
      .then((state) => setProfile(state.assignedProfile))
      .catch((error) => {
        console.error("[chatroom] getParticipantState failed:", error);
        const fallback = sessionStorage.getItem("assignedProfile") as ProfileSlot | null;
        if (fallback) setProfile(fallback);
      });
  }, []);

  //connect to socket
  useEffect(() => {
    // 1. URL parameters first (test harness or a direct link: ?session=...&participant=...).
    // 2. Otherwise sessionStorage (the normal flow from CodeEntry, with no query string).
    //    URL first because the test harness puts two iframes in one tab, and they
    //    share sessionStorage, so the query string is what tells X and Y apart.
    const params = new URLSearchParams(window.location.search);
    const sessionCode = params.get("session") ?? sessionStorage.getItem("sessionCode") ?? undefined;
    const participantCode =
      params.get("participant") ?? sessionStorage.getItem("participantCode") ?? undefined;

    if (!sessionCode || !participantCode) {
      console.warn("[chatroom] no session/participant in sessionStorage or URL");
      navigate("/chat");
      return;
    }

    console.log(`[chatroom] joining ${sessionCode} as ${participantCode}`);

    // participantCode -> myRole.
    // Format: P-X-C1-001 or TP-X-C1-001; X, Y or Z is the second part (split("-")[1]).
    const slot = participantCode.split("-")[1]; //X|Y|Z
    const roleHint: SenderRole | null =
      slot === "X" ? "humanX" : slot === "Y" ? "humanY" : slot === "Z" ? "humanZ" : null;
    setMyRole(roleHint);

    socket.connect();
    (window as Window & { socket?: typeof socket }).socket = socket;

    socket.on("connect", () => {
      console.log("[chatroom] connected", socket.id);
      socket.emit("join-session", { sessionCode, participantCode });
    });

    socket.on("disconnect", (reason) => {
      console.log("[chatroom] disconnected", reason);
    });

    socket.on("session-ready", ({ sessionCode, participantCount, startedAt }) => {
      console.log(`[chatroom] session ready: ${sessionCode} (${participantCount} participants)`);
      setStartTime(new Date(startedAt));
      setSessionReady(true);
    });

    socket.on("join-error", ({ reason }) => {
      console.error(`[chatroom] join error: ${reason}`);
    });

    //session history
    socket.on("session-history", ({ messages, startedAt, aiName }) => {
      console.log(`[chatroom] session-history: ${messages.length} messages`);
      // Sync the timer to the server's start time (falls back to the client clock if missing).
      setStartTime(startedAt ? new Date(startedAt) : new Date());
      if (startedAt) setSessionReady(true);
      if (aiName) setAiName(aiName); // the name shown for Alex in this condition
      const mapped: ChatMessage[] = messages.map((m) => ({
        id: `msg-${m.seq}`,
        sender: m.sender,
        senderRole: m.senderRole === roleHint ? "you" : m.senderRole === "ai" ? "ai" : "other",
        content: m.content,
        timestamp: new Date(m.createdAt),
        senderName:
          m.senderRole === "ai" ? "" : (ROLE_LABEL[m.senderRole as ParticipantRole] ?? m.sender),
      }));
      setMessages(mapped);
    });

    // peer-typing: update who is typing (the server relays it to everyone but the sender).
    socket.on("peer-typing", ({ role, isTyping }) => {
      setTypingRoles((prev) => {
        const has = prev.includes(role);
        if (isTyping && !has) return [...prev, role];
        if (!isTyping && has) return prev.filter((r) => r !== role);
        return prev;
      });
    });

    // Alex's typing indicator. Hidden during the floor pause; shown only once writing has started.
    socket.on("ai-typing", ({ isTyping }) => {
      setAiTyping(isTyping);
    });

    //new message
    socket.on("new-message", (msg) => {
      // A message arrived, so that participant is no longer typing.
      setTypingRoles((prev) => prev.filter((r) => r !== msg.senderRole));
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${msg.seq}`,
          sender: msg.sender,
          senderRole:
            msg.senderRole === roleHint ? "you" : msg.senderRole === "ai" ? "ai" : "other",
          content: msg.content,
          timestamp: new Date(msg.createdAt),
          senderName:
            msg.senderRole === "ai"
              ? ""
              : (ROLE_LABEL[msg.senderRole as ParticipantRole] ?? msg.sender),
        },
      ]);
    });

    socket.on("message-failed", ({ reason }) => {
      console.error("[chatroom] message-failed", reason);
    });

    socket.on("peer-disconnected", ({ role }) => {
      console.log(`[chatroom] peer-disconnected: ${role}`);
      // Clear the typing indicator of a participant who left.
      setTypingRoles((prev) => prev.filter((r) => r !== role));
    });

    socket.on("peer-reconnected", ({ role }) => {
      console.log(`[chatroom] peer-reconnected: ${role}`);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [navigate]);

  const handleSend = (content: string) => {
    socket.emit("send-message", { content });
    // not added to the UI
  };

  // Time running out does not move the room on; only the Exit button goes to the team decision.
  const handleTimerExpired = () => {
    setTimeUp(true);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex items-center justify-between px-6 py-3 border-b bg-card shrink-0">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-primary" />
          <span className="font-semibold">HAIT Experiment</span>
          {myRole && (
            <span className="text-xs text-muted-foreground ml-2">
              (you: {ROLE_LABEL[myRole as ParticipantRole] ?? myRole})
            </span>
          )}
        </div>
        {startTime && (
          <Timer
            durationMinutes={DISCUSSION_DURATION_MINUTES}
            startTime={startTime}
            onExpired={handleTimerExpired}
          />
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex flex-[2] flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                senderName={msg.senderRole === "ai" ? aiName : msg.senderName}
              />
            ))}
            {typingRoles.map((role) => (
              <TypingIndicator key={role} name={ROLE_LABEL[role] ?? role} />
            ))}
            {aiTyping && <TypingIndicator key="ai" name={aiName} />}
            <div ref={bottomRef} />
          </div>

          {timeUp && (
            <p className="text-center text-xs text-muted-foreground px-6 shrink-0">
              Time's up — click Exit below when your team is ready.
            </p>
          )}

          {canExit && (
            <div className="px-6 py-2 flex justify-center shrink-0">
              <button
                onClick={() => navigate("/chat/hold/teamDecision")}
                className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
              >
                Exit &amp; Make Team Decision
              </button>
            </div>
          )}

          <MessageInput
            onSend={handleSend}
            onTyping={(isTyping) => socket.emit("typing", { isTyping })}
            disabled={!sessionReady}
          />
        </div>

        <aside className="hidden md:flex flex-[1] min-w-[240px] max-w-[420px] flex-col border-l bg-muted/20 overflow-y-auto">
          {profile ? (
            <InfoCardPanel profile={profile} variant="static" compact showNote={false} showTitle />
          ) : (
            <div className="p-4 space-y-3 animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-20 bg-muted rounded" />
              <div className="h-20 bg-muted rounded" />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default ChatRoom;
