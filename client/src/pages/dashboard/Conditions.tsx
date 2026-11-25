import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Settings2, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConditionCode, RouteKind } from "@/types";
import { useConditions } from "@/hooks/useConditions";
import { conditionLabel } from "@/lib/conditions";
import { postTestChat } from "@/lib/api";

const matrix: [ConditionCode, ConditionCode][] = [
  ["C1", "C2"],
  ["C3", "C4"],
];

// Script for the test chat. X and Y lines are fixed; AI turns only carry a
// trigger label (the text comes from a live call).
type ScriptTurn = { speaker: "X" | "Y"; text: string } | { speaker: "AI" };

// The real trigger settings (kept in step with server/src/config/triggers.ts), for labels only.
const TRIGGER_LABEL: Record<string, string> = {
  address: "direct address · 2s floor",
  followup: "single reply after Alex · 2s floor",
  long_silence: "60s silence · no extra floor",
  build_on: "main judge contribution · 3s floor",
  mediation: "leader coverage intervention · 3s floor",
  backchannel: "main judge acknowledgment · 3s floor",
  greeting: "session start",
  summary: "one-time leader checkpoint · 3s floor",
  closing: "30-minute deadline or manual stop",
};

const ROUTE_ORDER: RouteKind[] = [
  "greeting",
  "address",
  "followup",
  "long_silence",
  "build_on",
  "mediation",
  "backchannel",
  "summary",
  "closing",
];

// A hidden-profile script (senders are humanX and humanY).
const SCRIPT: ScriptTurn[] = [
  {
    speaker: "X",
    text: "From my side: Candidate C is stress resistant and promotes a good atmosphere within the crew. But Candidate A is sometimes hectic and doesn't tolerate criticism.",
  },
  {
    speaker: "Y",
    text: "On my end, Candidate C is very conscientious and skilled with complicated technology. Candidate B gossips about coworkers and isn't very cooperative.",
  },
  {
    speaker: "X",
    text: "Also, Candidate D is considered arrogant and not well suited for leading a team.",
  },
  { speaker: "Y", text: "Hmm, and Candidate B has a below-average memory for numbers too." },
  { speaker: "X", text: "Right. So what does everyone think so far?" },
  { speaker: "AI" },
  { speaker: "Y", text: "I'm leaning toward C based on what we've shared." },
  { speaker: "X", text: "Same, C seems strong on the safety side." },
  { speaker: "X", text: "..." },
  { speaker: "AI" },
];

// A message shown in the test chat (collected as the script plays).
interface PlayedMessage {
  speaker: "X" | "Y" | "AI";
  text: string;
  trigger?: string; // AI only
  latencyMs?: number; // AI only
}

const Conditions = () => {
  const { data, isLoading, isError, error } = useConditions();
  const [selected, setSelected] = useState<ConditionCode>("C1");
  const [selectedRoute, setSelectedRoute] = useState<RouteKind>("build_on");
  const [testOpen, setTestOpen] = useState(false);
  // Test chat state.
  const [step, setStep] = useState(0); // position in the script
  const [played, setPlayed] = useState<PlayedMessage[]>([]); // messages played so far
  const [loading, setLoading] = useState(false); // waiting for Alex
  const [variants, setVariants] = useState<PlayedMessage[]>([]); // extra replies generated at the end
  const [testError, setTestError] = useState<string | null>(null);

  const atEnd = step >= SCRIPT.length;

  const selectedEntry = data?.conditions?.[selected];
  const availableRoutes = ROUTE_ORDER.filter((route) => selectedEntry?.routes?.[route]);
  useEffect(() => {
    if (selected === "CTRL") return;
    if (!selectedEntry?.routes?.[selectedRoute] && availableRoutes.length) {
      setSelectedRoute(availableRoutes[0]);
    }
  }, [availableRoutes, selected, selectedEntry, selectedRoute]);

  // Reset when the dialog opens.
  const openTest = () => {
    setStep(0);
    setPlayed([]);
    setVariants([]);
    setTestError(null);
    setTestOpen(true);
  };

  // Build the transcript for the AI call: played messages as humanX, humanY or ai.
  const buildTranscript = (msgs: PlayedMessage[]) =>
    msgs.map((m) => ({
      sender: m.speaker === "X" ? "humanX" : m.speaker === "Y" ? "humanY" : "ai",
      content: m.text,
    }));

  // "Next": play one turn of the script.
  const handleNext = async () => {
    if (atEnd || loading) return;
    const turn = SCRIPT[step];

    if (turn.speaker !== "AI") {
      // X or Y: add the fixed text at once.
      setPlayed((p) => [...p, { speaker: turn.speaker, text: turn.text }]);
      setStep((s) => s + 1);
      return;
    }

    // AI: call with the transcript so far.
    setLoading(true);
    setTestError(null);
    try {
      const res = await postTestChat({
        conditionCode: selected,
        routeKind: selectedRoute,
        transcript: buildTranscript(played),
      });
      setPlayed((p) => [
        ...p,
        { speaker: "AI", text: res.content, trigger: selectedRoute, latencyMs: res.latencyMs },
      ]);
      setStep((s) => s + 1);
    } catch (e) {
      setTestError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // "Generate again": call Alex again at the end with the same transcript (adds another variant).
  const handleRegenerate = async () => {
    if (loading) return;
    setLoading(true);
    setTestError(null);
    try {
      // The transcript up to the last AI turn (what that turn received).
      const beforeLastAI = played.slice(0, played.length - 1);
      const res = await postTestChat({
        conditionCode: selected,
        routeKind: selectedRoute,
        transcript: buildTranscript(beforeLastAI),
      });
      setVariants((v) => [...v, { speaker: "AI", text: res.content, latencyMs: res.latencyMs }]);
    } catch (e) {
      setTestError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // The selected condition's prompts (CTRL has none, so undefined).
  const entry = data?.conditions?.[selected];
  const routeEntry = entry?.routes?.[selectedRoute];

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings2 className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-semibold">Condition Manager</h1>
        </div>
        {/* Read only */}
        <span className="text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
          Read-only · compiled prompts
        </span>
      </div>

      {/* Loading and errors */}
      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading prompts…
        </div>
      )}
      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load conditions: {(error as Error)?.message}
        </div>
      )}

      {/* Condition Matrix */}
      <div className="rounded-xl border bg-card p-6 shadow-card space-y-3">
        <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-center">
          <div />
          <div className="text-xs font-semibold text-muted-foreground uppercase">Peer AI</div>
          <div className="text-xs font-semibold text-muted-foreground uppercase">Leader AI</div>
        </div>
        {(["XAI", "ACI"] as const).map((strat, ri) => (
          <div key={strat} className="grid grid-cols-[120px_1fr_1fr] gap-2">
            <div className="flex items-center justify-center text-xs font-semibold text-muted-foreground uppercase">
              {strat} Strategy
            </div>
            {matrix[ri].map((code) => (
              <button
                key={code}
                onClick={() => setSelected(code)}
                className={cn(
                  "rounded-lg border-2 p-4 text-left transition-all",
                  selected === code
                    ? "border-primary bg-primary/10 ring-2 ring-primary/30 shadow-md"
                    : "border-input hover:border-primary/40",
                )}
              >
                <div className="font-mono font-bold text-sm">{code}</div>
                <div className="text-xs text-muted-foreground mt-1">{conditionLabel[code]}</div>
              </button>
            ))}
          </div>
        ))}
        <div className="grid grid-cols-[120px_1fr] gap-2">
          <div className="flex items-center justify-center text-xs font-semibold text-muted-foreground uppercase">
            Control
          </div>
          <button
            onClick={() => setSelected("CTRL")}
            className={cn(
              "rounded-lg border-2 p-4 text-left transition-all",
              selected === "CTRL"
                ? "border-primary bg-primary/10 ring-2 ring-primary/30 shadow-md"
                : "border-input hover:border-primary/40",
            )}
          >
            <div className="font-mono font-bold text-sm">CTRL</div>
            <div className="text-xs text-muted-foreground mt-1">3-human team, no AI</div>
          </button>
        </div>
      </div>

      {/* CTRL: no prompt */}
      {selected === "CTRL" ? (
        <div className="rounded-xl border bg-card p-6 shadow-card text-sm text-muted-foreground">
          CTRL is a 3-human team with no AI participant. There is no system prompt for this
          condition.
        </div>
      ) : (
        <>
          {/* System prompt, read only */}
          <div className="rounded-xl border bg-card p-6 shadow-card space-y-3">
            <div className="flex flex-wrap gap-2 pb-2">
              {availableRoutes.map((route) => (
                <Button
                  key={route}
                  variant={selectedRoute === route ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedRoute(route)}
                >
                  {route}
                </Button>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-medium">
                  System Prompt — {selected}.{selectedRoute}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {conditionLabel[selected]} · {routeEntry?.promptKey ?? ""}
                  {routeEntry ? ` · ${routeEntry.prompt.length.toLocaleString()} chars` : ""}
                </p>
                {routeEntry && (
                  <p className="text-[10px] font-mono text-muted-foreground mt-1 break-all">
                    sha256 {routeEntry.hash}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={openTest} disabled={!routeEntry}>
                <Play className="w-3.5 h-3.5 mr-1.5" /> Test Chat
              </Button>
            </div>
            <pre className="w-full max-h-[36rem] overflow-auto rounded-lg border border-input bg-muted/30 px-4 py-3 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">
              {routeEntry?.prompt ?? ""}
            </pre>
          </div>
        </>
      )}

      {/* Test chat player */}
      {testOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setTestOpen(false)} />
          <div className="relative w-full max-w-md bg-card border-l shadow-xl flex flex-col animate-in slide-in-from-right">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h3 className="font-semibold text-sm">
                  Test Chat — {selected}.{selectedRoute}: {conditionLabel[selected]}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Scripted simulation · live runtime model · not saved
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setTestOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {played.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">
                  Press "Next" to play the scripted discussion. Alex (AI) responds live at each
                  trigger point.
                </p>
              )}
              {played.map((m, i) => (
                <MsgBubble key={i} m={m} />
              ))}

              {/* Extra replies generated at the end */}
              {atEnd && variants.length > 0 && (
                <div className="mt-4 pt-4 border-t space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Regenerated variants (same transcript)
                  </p>
                  {variants.map((m, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5"
                    >
                      <div className="text-[10px] font-mono text-primary/70 mb-1">
                        variant #{i + 1} · {m.latencyMs}ms
                      </div>
                      <div className="text-sm whitespace-pre-wrap">{m.text}</div>
                    </div>
                  ))}
                </div>
              )}

              {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Alex is responding…
                </div>
              )}
              {testError && (
                <div className="text-xs text-destructive border border-destructive/30 rounded-lg p-2">
                  {testError}
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="border-t p-4 space-y-2">
              {!atEnd ? (
                <Button className="w-full" onClick={handleNext} disabled={loading}>
                  {SCRIPT[step]?.speaker === "AI" ? "Next — trigger Alex's response" : "Next"}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={handleRegenerate}
                  disabled={loading}
                >
                  <Play className="w-3.5 h-3.5 mr-1.5" />
                  Generate again (same transcript)
                </Button>
              )}
              <p className="text-xs text-muted-foreground text-center">
                {atEnd
                  ? `Script complete (${played.length} turns). Regenerate to compare AI variants.`
                  : `Turn ${step + 1} of ${SCRIPT.length}`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Test chat message bubble. AI messages show their trigger and a different colour.
const MsgBubble = ({ m }: { m: PlayedMessage }) => {
  const isAI = m.speaker === "AI";
  return (
    <div className={cn("flex gap-3", isAI && "flex-row")}>
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
          isAI ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {isAI ? "A" : m.speaker}
      </div>
      <div className="flex-1 min-w-0">
        {isAI && m.trigger && (
          <div className="text-[10px] font-mono text-primary/70 mb-1">
            ⚡ {m.trigger} · {TRIGGER_LABEL[m.trigger]}
            {m.latencyMs != null ? ` · ${m.latencyMs}ms` : ""}
          </div>
        )}
        <div
          className={cn(
            "rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap break-words",
            isAI ? "border-2 border-primary/30 bg-primary/5" : "bg-muted/50",
          )}
        >
          {m.text}
        </div>
      </div>
    </div>
  );
};

export default Conditions;
