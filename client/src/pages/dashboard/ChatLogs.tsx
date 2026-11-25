import { useState } from "react";
import { useSessionList, useSessionDetail } from "@/hooks/useSessions";
import { conditionLabel } from "@/lib/conditions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { SessionViewTabs } from "@/components/dashboard/SessionViewTabs";
import { useSessionView } from "@/hooks/useSessionView";
import { sessionsInView } from "@/lib/sessionView";
import { getSession, type ConditionCode, type SessionDetail } from "@/lib/api";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "@/lib/csv";

type Filter = "all" | "humans" | "ai";

type ChatMessage = SessionDetail["messages"][number];
// One CSV row is one message plus its session (needed because a full export mixes sessions).
type CsvRow = ChatMessage & { sessionCode: string; conditionCode: ConditionCode };

const CSV_COLUMNS: CsvColumn<CsvRow>[] = [
  { header: "session_code", value: (r) => r.sessionCode },
  { header: "condition_code", value: (r) => r.conditionCode },
  { header: "condition_label", value: (r) => conditionLabel[r.conditionCode] },
  { header: "seq", value: (r) => r.seq },
  { header: "sender", value: (r) => r.sender },
  { header: "sender_role", value: (r) => r.senderRole },
  { header: "is_ai", value: (r) => (r.senderRole === "ai" ? 1 : 0) },
  // ISO time (UTC), easy for analysis scripts to parse
  { header: "created_at", value: (r) => new Date(r.createdAt).toISOString() },
  { header: "content", value: (r) => r.content },
];

// The CSV uses the same filters as the screen (what you see is what you download).
function applyFilter(messages: ChatMessage[], filter: Filter): ChatMessage[] {
  if (filter === "all") return messages;
  return filter === "ai"
    ? messages.filter((m) => m.senderRole === "ai")
    : messages.filter((m) => m.senderRole !== "ai");
}

const ChatLogs = () => {
  const { data: sessions = [], isSuccess: sessionsLoaded } = useSessionList();
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [exporting, setExporting] = useState(false);
  // Session tab (All / Main / Test): same rules as the Sessions page, kept in the address as ?view=.
  const [view, setView] = useSessionView();
  const visibleSessions = sessionsInView(sessions, view);

  // If the chosen session is not in this tab (none chosen yet, or the tab changed), show the tab's first session.
  const activeCode =
    (selectedCode && visibleSessions.some((s) => s.sessionCode === selectedCode)
      ? selectedCode
      : visibleSessions[0]?.sessionCode) ?? null;
  // The chosen session's details (with messages); refreshes every 3 seconds while in progress.
  const { data: detail } = useSessionDetail(activeCode ?? undefined);

  const sessionMessages = detail?.messages ?? [];
  const filtered = applyFilter(sessionMessages, filter);

  const filterSuffix = filter === "all" ? "" : `_${filter}`;

  // The current session: use the messages already loaded (no extra request).
  const exportCurrent = () => {
    if (!detail) return;
    const rows: CsvRow[] = filtered.map((m) => ({
      ...m,
      sessionCode: detail.session.sessionCode,
      conditionCode: detail.session.conditionCode,
    }));
    downloadCsv(
      `chatlogs_${detail.session.sessionCode}${filterSuffix}_${fileStamp()}.csv`,
      toCsv(rows, CSV_COLUMNS),
    );
  };

  // Every session in this tab (the tab you see is what you download). Details are
  // fetched four sessions at a time so the server is not overloaded.
  const exportAll = async () => {
    setExporting(true);
    try {
      const rows: CsvRow[] = [];
      for (let i = 0; i < visibleSessions.length; i += 4) {
        const batch = await Promise.all(
          visibleSessions.slice(i, i + 4).map((s) =>
            getSession(s.sessionCode).catch((e) => {
              console.error(`[chatlogs] export failed: ${s.sessionCode}`, e);
              return null;
            }),
          ),
        );
        for (const d of batch) {
          if (!d) continue;
          for (const m of applyFilter(d.messages, filter)) {
            rows.push({
              ...m,
              sessionCode: d.session.sessionCode,
              conditionCode: d.session.conditionCode,
            });
          }
        }
      }
      downloadCsv(`chatlogs_${view}${filterSuffix}_${fileStamp()}.csv`, toCsv(rows, CSV_COLUMNS));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Chat Logs</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={exporting || visibleSessions.length === 0}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={exportCurrent} disabled={filtered.length === 0}>
              This session ({filtered.length} messages)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={exportAll}>
              {view === "all" ? "All sessions" : `All ${view} sessions`} ({visibleSessions.length})
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <SessionViewTabs
        view={view}
        onChange={setView}
        sessions={sessionsLoaded ? sessions : undefined}
      />

      <div className="flex gap-6">
        <div className="w-56 shrink-0 space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase">Session</label>
          <div className="space-y-1">
            {visibleSessions.map((s) => (
              <button
                key={s.sessionCode}
                onClick={() => setSelectedCode(s.sessionCode)}
                className={cn(
                  "w-full text-left rounded-lg px-3 py-2 text-sm transition-colors",
                  activeCode === s.sessionCode
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted text-muted-foreground",
                )}
              >
                <div className="font-mono">{s.sessionCode}</div>
                <div className="text-xs">{conditionLabel[s.conditionCode]}</div>
              </button>
            ))}
            {sessionsLoaded && visibleSessions.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {view === "all" ? "No sessions yet" : `No ${view} sessions yet`}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-4">
          <div className="flex gap-2">
            {(["all", "humans", "ai"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {f === "all" ? "All" : f === "humans" ? "Humans Only" : "AI Only"}
              </button>
            ))}
          </div>

          <div className="rounded-xl bg-card shadow-card divide-y">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No messages found for this session
              </div>
            ) : (
              filtered.map((m) => (
                <div key={m.seq} className="flex gap-4 px-5 py-3">
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      m.senderRole === "ai" ? "bg-chat-ai" : "bg-muted",
                    )}
                  >
                    {m.senderRole === "ai" ? (
                      <Bot className="w-4 h-4 text-chat-ai-badge" />
                    ) : (
                      <User className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {m.senderRole === "ai" ? "AI Alex" : m.sender}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(m.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      {m.senderRole === "ai" && (
                        <span className="text-[10px] font-semibold text-chat-ai-badge bg-chat-ai rounded px-1.5 py-0.5">
                          AI
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
                      {m.content}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatLogs;
