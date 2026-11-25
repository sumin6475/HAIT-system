// Sessions dashboard page.
//   - session list (refreshes every 5 seconds)
//   - create a session (condition + test or study)
//   - click a session to see and copy participant links
//   - delete a session
//   - All / Main / Test tabs (kept in the address as ?view=)

import { useEffect, useRef, useState } from "react";
import {
  useSessionList,
  useSessionDetail,
  useCreateSession,
  useDeleteSession,
  useApproveGate,
  useStopAI,
} from "@/hooks/useSessions";
import type { ConditionCode, SessionSummary } from "@/lib/api";
import { GATES } from "@/lib/gates";
import { cn } from "@/lib/utils";
import { SessionViewTabs } from "@/components/dashboard/SessionViewTabs";
import { useSessionView } from "@/hooks/useSessionView";
import { isMainSession, sessionsInView, type SessionView } from "@/lib/sessionView";

const CONDITIONS: ConditionCode[] = ["C1", "C2", "C3", "C4", "CTRL"];

const conditionLabel: Record<ConditionCode, string> = {
  C1: "C1 · Peer + XAI",
  C2: "C2 · Leader + XAI",
  C3: "C3 · Peer + ACI",
  C4: "C4 · Leader + ACI",
  CTRL: "CTRL · No AI",
};

const statusBadge = (status: string) => {
  const styles: Record<string, string> = {
    completed: "bg-status-success/10 text-status-success",
    data_ready: "bg-status-success/10 text-status-success",
    in_progress: "bg-status-warning/10 text-status-warning",
    waiting: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "text-xs font-medium px-2.5 py-0.5 rounded-full",
        styles[status] || styles.waiting,
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
};

const Sessions = () => {
  const { data: sessions, isLoading, error } = useSessionList();
  const createMutation = useCreateSession();
  const deleteMutation = useDeleteSession();
  const stopAIMutation = useStopAI();

  const [selectedCondition, setSelectedCondition] = useState<ConditionCode>("C1");
  const [isTest, setIsTest] = useState(true);
  const [detailCode, setDetailCode] = useState<string | null>(null);

  // List tab, kept in the address as ?view=. Separate from the 5-second refresh.
  const [view, setView] = useSessionView();
  const visibleSessions = sessions ? sessionsInView(sessions, view) : undefined;

  const handleCreate = () => {
    createMutation.mutate(
      { conditionCode: selectedCondition, isTest },
      {
        onSuccess: (res) => {
          // Open the detail dialog right after creating, so the links are easy to copy.
          setDetailCode(res.session.sessionCode);
          // If the new session belongs to a tab not shown now, switch to that tab, so the new session does not seem to vanish.
          const createdView: SessionView = isMainSession(res.session) ? "main" : "test";
          if (view !== "all" && view !== createdView) setView(createdView);
        },
        onError: (e) => alert(`Could not create the session: ${(e as Error).message}`),
      },
    );
  };

  const handleDelete = (code: string) => {
    if (!confirm(`Delete ${code}? Its participants and messages are deleted too.`)) return;
    deleteMutation.mutate(code, {
      onError: (e) => alert(`Could not delete the session: ${(e as Error).message}`),
    });
  };

  // Researcher stop switch: mutes Alex in this session for good (humans, chat and timer carry on).
  const handleStopAI = (code: string) => {
    if (!confirm(`Mute Alex in session ${code}? This cannot be undone.`)) return;
    stopAIMutation.mutate(code, {
      onSuccess: () => alert("AI muted"),
      onError: (e) => alert(`Could not mute Alex: ${(e as Error).message}`),
    });
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sessions</h1>
      </div>

      {/* Create */}
      <div className="rounded-xl bg-card shadow-card p-5 flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Condition</label>
          <select
            value={selectedCondition}
            onChange={(e) => setSelectedCondition(e.target.value as ConditionCode)}
            className="rounded-lg border bg-background px-3 py-2 text-sm"
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {conditionLabel[c]}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm pb-2">
          <input
            type="checkbox"
            checked={isTest}
            onChange={(e) => setIsTest(e.target.checked)}
            className="rounded"
          />
          Test session (T- prefix)
        </label>

        <button
          onClick={handleCreate}
          disabled={createMutation.isPending}
          className="ml-auto rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {createMutation.isPending ? "Creating…" : "Create Session"}
        </button>
      </div>

      {/* List tabs */}
      <SessionViewTabs view={view} onChange={setView} sessions={sessions} />

      {/* List */}
      <div className="rounded-xl bg-card shadow-card overflow-hidden">
        {isLoading && <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>}
        {error && (
          <div className="p-8 text-center text-sm text-destructive">
            Error: {(error as Error).message}
          </div>
        )}
        {!isLoading && !error && (
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Session
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Condition
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Gate
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Participants
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Created
                </th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleSessions?.map((s) => (
                <SessionRow
                  key={s.sessionCode}
                  session={s}
                  onOpen={() => setDetailCode(s.sessionCode)}
                  onDelete={() => handleDelete(s.sessionCode)}
                  onStopAI={() => handleStopAI(s.sessionCode)}
                  stopAIPending={stopAIMutation.isPending}
                />
              ))}
              {visibleSessions && visibleSessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                    {view === "all"
                      ? "No sessions yet. Create one above."
                      : `No ${view} sessions yet.`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail dialog */}
      {detailCode && <SessionDetailModal code={detailCode} onClose={() => setDetailCode(null)} />}
    </div>
  );
};

// --- One session row ---
function SessionRow({
  session,
  onOpen,
  onDelete,
  onStopAI,
  stopAIPending,
}: {
  session: SessionSummary;
  onOpen: () => void;
  onDelete: () => void;
  onStopAI: () => void;
  stopAIPending: boolean;
}) {
  const max = session.conditionCode === "CTRL" ? 3 : 2;
  // Muting Alex only makes sense for a session in progress, in a condition with Alex (not CTRL).
  const canStopAI = session.status === "in_progress" && session.conditionCode !== "CTRL";
  return (
    <tr className="hover:bg-muted/20 transition-colors">
      <td className="px-5 py-3 font-mono text-sm font-medium">
        <button onClick={onOpen} className="hover:underline">
          {session.sessionCode}
        </button>
        {!isMainSession(session) && (
          <span className="ml-2 text-[10px] uppercase rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
            test
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-sm text-muted-foreground">
        {conditionLabel[session.conditionCode]}
      </td>
      <td className="px-5 py-3">{statusBadge(session.status)}</td>
      <td className="px-5 py-3">
        <GateCell session={session} />
      </td>
      <td className="px-5 py-3 text-sm">
        {session.participantCount}/{max}
      </td>
      <td className="px-5 py-3 text-sm text-muted-foreground">
        {new Date(session.createdAt).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </td>
      <td className="px-5 py-3 text-right whitespace-nowrap">
        {canStopAI && (
          <button
            onClick={onStopAI}
            disabled={stopAIPending}
            title="Mute Alex in this session for good (humans, chat and timer carry on)"
            className="text-xs text-status-warning hover:underline font-medium mr-3 disabled:opacity-40"
          >
            Stop AI
          </button>
        )}
        <button onClick={onDelete} className="text-xs text-destructive hover:underline font-medium">
          Delete
        </button>
      </td>
    </tr>
  );
}

// --- Gate cell: shows the waiting gate, with Approve and force ---
// Which gate is waiting comes from the client's gate list (GATES); disabled gates are skipped.
function GateCell({ session }: { session: SessionSummary }) {
  const approveMutation = useApproveGate();
  // Two-step confirm on the page: the first click arms, the second runs. The
  // browser's confirm() is not used, because a browser set to block dialogs would
  // disable the button for good. The armed state clears after 4 seconds.
  const [armed, setArmed] = useState<null | "approve" | "force">(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  const pending = GATES.find((g) => g.enabled && !session.gates?.approvals?.[g.id]);
  if (session.status === "data_ready" || !pending) {
    return <span className="text-sm text-muted-foreground">✓</span>;
  }

  const arrived = session.gates?.arrivals?.[pending.id] ?? 0;
  const expected = session.participantCount;
  const allArrived = arrived === expected;

  const disarm = () => {
    if (armTimer.current) clearTimeout(armTimer.current);
    setArmed(null);
  };
  // A second click on the same button runs it; the first arms it (4-second timer).
  const click = (which: "approve" | "force") => {
    if (armed === which) {
      disarm();
      approveMutation.mutate(
        { sessionCode: session.sessionCode, gate: pending.id },
        { onError: (e) => alert(`Could not approve the gate: ${(e as Error).message}`) },
      );
      return;
    }
    setArmed(which);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(null), 4000);
  };

  return (
    <div className="flex items-center gap-2 text-sm whitespace-nowrap">
      <span className="text-muted-foreground">
        → {pending.nextLabel}{" "}
        <span className={cn("font-mono text-xs", allArrived && "text-status-success")}>
          {arrived}/{expected}
        </span>
      </span>
      <button
        onClick={() => click("approve")}
        disabled={!allArrived || approveMutation.isPending}
        title={
          armed === "approve"
            ? "Click again to approve now: participants move to the next screen (cannot be undone)"
            : `Approve '${pending.nextLabel}'`
        }
        className={cn(
          "rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40",
          armed === "approve"
            ? "bg-status-warning text-white"
            : "bg-primary text-primary-foreground",
        )}
      >
        {armed === "approve" ? "Confirm?" : "Approve"}
      </button>
      {!allArrived && (
        <button
          onClick={() => click("force")}
          disabled={approveMutation.isPending}
          title={
            armed === "force"
              ? `Click again to approve with ${arrived}/${expected} arrived (for solo testing)`
              : "force approve (not everyone has arrived)"
          }
          className={cn(
            "text-[10px] underline",
            armed === "force"
              ? "text-status-warning font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {armed === "force" ? "force?" : "force"}
        </button>
      )}
    </div>
  );
}

// --- Detail dialog (copy participant links) ---
function SessionDetailModal({ code, onClose }: { code: string; onClose: () => void }) {
  // The dialog loads the session details with its own hook.

  const { data, isLoading } = useSessionDetail(code);

  const chatBaseUrl = window.location.origin + "/chat";

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-lg max-w-2xl w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold font-mono">{code}</h2>
            {data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {conditionLabel[data.session.conditionCode]} · {data.session.status}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

          {data && (
            <>
              <div>
                <h3 className="text-sm font-medium mb-2">Participant URLs</h3>
                <div className="space-y-2">
                  {data.participants.map((p) => {
                    const url = `${chatBaseUrl}?code=${p.participantCode}`;
                    return (
                      <div
                        key={p.participantCode}
                        className="rounded-lg border p-3 flex items-center gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-muted-foreground">
                            {p.role} (profile {p.assignedProfile})
                          </div>
                          <div className="font-mono text-xs truncate mt-0.5">{url}</div>
                        </div>
                        <button
                          onClick={() => copy(url)}
                          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium shrink-0"
                        >
                          Copy URL
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">Distribution message</h3>
                <DistributionMessage
                  sessionCode={code}
                  participants={data.participants}
                  baseUrl={chatBaseUrl}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Message to send participants (copy button) ---
function DistributionMessage({
  sessionCode,
  participants,
  baseUrl,
}: {
  sessionCode: string;
  participants: { participantCode: string; role: string; assignedProfile: string }[];
  baseUrl: string;
}) {
  const message = [
    `[HAIT Study - Session — ${sessionCode}]`,
    ``,
    `The study consists of 3 parts (~45 min total):`,
    ``,
    `1. Consent & pre-survey (~10 min)`,
    `   Link: (Qualtrics link — to be added)`,
    ``,
    `2. Chat task (~20 min)`,
    ...participants.map(
      (p) => `   Participant ${p.assignedProfile}: ${baseUrl}?code=${p.participantCode}`,
    ),
    ``,
    `3. Post-survey (~10 min): you'll be guided here after the chat ends`,
  ].join("\n");

  return (
    <div className="space-y-2">
      <pre className="text-xs bg-muted rounded-lg p-3 whitespace-pre-wrap font-mono max-h-48 overflow-auto">
        {message}
      </pre>
      <button
        onClick={() => navigator.clipboard.writeText(message)}
        className="rounded-md bg-secondary text-secondary-foreground px-3 py-1.5 text-xs font-medium"
      >
        Copy message
      </button>
    </div>
  );
}

export default Sessions;
