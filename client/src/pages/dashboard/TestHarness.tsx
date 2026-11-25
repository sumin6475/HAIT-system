// Test harness: a development page for trying the chat directly.
//
// It skips the onboarding steps (consent, demographics, ... waiting), creates a
// test session for the chosen condition, and opens the real /chat/room twice in
// two iframes: participant X on the left, Y on the right.
//
// Why iframes: the socket in client/src/lib/socket.ts is a single shared module,
// so two ChatRooms on one page would fight over one socket. Each same-origin
// iframe is its own browsing context with its own socket, so the real ChatRoom
// runs unchanged (Chair opening, Judge, closing and all). ChatRoom reads the URL
// query (?session=&participant=) before sessionStorage, which is what makes the
// two iframes X and Y.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, RefreshCw, Download, Trash2, FlaskConical } from "lucide-react";
import { useCreateSession, useDeleteSession } from "@/hooks/useSessions";
import { exportSession, type ConditionCode, type SessionExport } from "@/lib/api";

// Conditions with Alex only (CTRL has three humans and no AI, so there is nothing to test).
const CONDITIONS: { code: ConditionCode; label: string; leader: boolean }[] = [
  { code: "C1", label: "C1 (peer)", leader: false },
  { code: "C2", label: "C2 (leader)", leader: true },
  { code: "C3", label: "C3 (peer)", leader: false },
  { code: "C4", label: "C4 (leader)", leader: true },
];

type Run = { sessionCode: string; x: string; y: string };

// senderRole -> label, for the Markdown transcript.
const ROLE_LABEL: Record<string, string> = {
  humanX: "Participant X",
  humanY: "Participant Y",
  humanZ: "Participant Z",
  ai: "AI",
};

// Builds a readable Markdown transcript with an appendix of Alex's decisions (in the browser, no extra server call).
function toMarkdown(data: SessionExport): string {
  const lines: string[] = [];
  lines.push(`# ${data.session.sessionCode} (${data.session.conditionCode})`);
  lines.push(
    `status: ${data.session.status} · ` +
      `started: ${data.session.startedAt ?? "—"} · ended: ${data.session.endedAt ?? "—"}`,
  );
  if (data.session.aiState) {
    lines.push(
      `AI: ${data.session.aiState.lifecycle ?? "—"} · summary: ` +
        `${data.session.aiState.summaryStatus ?? "—"} · mediation latched: ` +
        `${data.session.aiState.mediationLatched ?? false}`,
    );
  }
  lines.push("");
  lines.push("## Transcript");
  for (const m of data.messages) {
    lines.push(`**[${m.seq}] ${ROLE_LABEL[m.senderRole] ?? m.senderRole}:** ${m.content}`);
  }
  lines.push("");
  lines.push("## AI interventions");
  lines.push(
    "| turn | stage | decision | route | source | judge | outcome | route reason | silence reason | floor | evidence |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const i of data.interventions) {
    const evidence = (i.judgeEvidence ?? i.priorityEvidence ?? i.silenceReason ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, " ");
    lines.push(
      `| ${i.turnIndex} | ${i.decisionStage ?? "—"} | ${i.decision} | ` +
        `${i.routeKind ?? "—"} | ${i.source ?? "—"} | ${i.mainJudgeDecision ?? "—"} | ` +
        `${i.outcome ?? "—"} | ${i.routeReason ?? "—"} | ${i.silenceReason ?? "—"} | ` +
        `${i.floorMs ?? 0}ms | ${evidence} |`,
    );
  }
  return lines.join("\n");
}

// Download as a Blob (no dependencies).
function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const chatSrc = (sessionCode: string, participantCode: string) =>
  `/chat/room?session=${encodeURIComponent(sessionCode)}&participant=${encodeURIComponent(participantCode)}`;

const TestHarness = () => {
  const [condition, setCondition] = useState<ConditionCode>("C2");
  const [run, setRun] = useState<Run | null>(null);
  const [iframeKey, setIframeKey] = useState(0); // bump to remount both iframes (new sockets)
  const [downloading, setDownloading] = useState(false);

  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();

  // New run: create a test session, take the X and Y codes, remount the iframes.
  const onStart = async () => {
    const resp = await createSession.mutateAsync({ conditionCode: condition, isTest: true });
    const x = resp.participants.find((p) => p.assignedProfile === "X")?.participantCode;
    const y = resp.participants.find((p) => p.assignedProfile === "Y")?.participantCode;
    if (!x || !y) {
      console.error("[harness] X/Y participant code missing", resp.participants);
      return;
    }
    setRun({ sessionCode: resp.session.sessionCode, x, y });
    setIframeKey((k) => k + 1);
  };

  // Rejoin the same session (after a dropped connection): only the iframes reload.
  const onReload = () => setIframeKey((k) => k + 1);

  const onDownload = async (fmt: "json" | "md") => {
    if (!run) return;
    setDownloading(true);
    try {
      const data = await exportSession(run.sessionCode);
      if (fmt === "json") {
        download(`${run.sessionCode}.json`, JSON.stringify(data, null, 2), "application/json");
      } else {
        download(`${run.sessionCode}.md`, toMarkdown(data), "text/markdown");
      }
    } catch (e) {
      console.error("[harness] export failed", e);
    } finally {
      setDownloading(false);
    }
  };

  const onDelete = async () => {
    if (!run) return;
    await deleteSession.mutateAsync(run.sessionCode);
    setRun(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Control bar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b bg-card flex-wrap">
        <div className="flex items-center gap-2 mr-2">
          <FlaskConical className="w-5 h-5 text-primary" />
          <span className="font-semibold">Test Harness</span>
        </div>

        {/* Condition */}
        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          {CONDITIONS.map((c) => (
            <button
              key={c.code}
              onClick={() => setCondition(c.code)}
              className={
                "px-3 py-1.5 text-sm rounded-md transition-colors " +
                (condition === c.code
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground")
              }
              title={
                c.leader
                  ? "Chair condition: Alex opens and closes the discussion"
                  : "Member condition"
              }
            >
              {c.label}
            </button>
          ))}
        </div>

        <Button onClick={onStart} disabled={createSession.isPending} className="gap-2">
          <Play className="w-4 h-4" />
          {run ? "Start new run" : "Start"}
        </Button>

        {run && (
          <>
            <Button onClick={onReload} variant="outline" className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Reload panes
            </Button>
            <Button
              onClick={() => onDownload("json")}
              variant="outline"
              disabled={downloading}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              JSON
            </Button>
            <Button
              onClick={() => onDownload("md")}
              variant="outline"
              disabled={downloading}
              className="gap-2"
            >
              <Download className="w-4 h-4" />
              MD
            </Button>
            <Button
              onClick={onDelete}
              variant="ghost"
              disabled={deleteSession.isPending}
              className="gap-2 text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </Button>
            <span className="ml-auto text-xs text-muted-foreground font-mono">
              {run.sessionCode}
            </span>
          </>
        )}
      </div>

      {/* Two chat windows (X left, Y right) */}
      {run ? (
        <div className="flex-1 grid grid-cols-2 gap-px bg-border min-h-0">
          <div className="flex flex-col bg-background min-h-0">
            <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground border-b bg-muted/40">
              ← Participant X
            </div>
            <iframe
              key={`x-${iframeKey}`}
              title="Participant X"
              src={chatSrc(run.sessionCode, run.x)}
              className="w-full flex-1 border-0"
            />
          </div>
          <div className="flex flex-col bg-background min-h-0">
            <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground border-b bg-muted/40">
              Participant Y →
            </div>
            <iframe
              key={`y-${iframeKey}`}
              title="Participant Y"
              src={chatSrc(run.sessionCode, run.y)}
              className="w-full flex-1 border-0"
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Choose a condition and press{" "}
          <span className="mx-1 font-semibold text-foreground">Start</span> to open the two
          participants' chat windows side by side.
        </div>
      )}
    </div>
  );
};

export default TestHarness;
