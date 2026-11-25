import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { markProgress, finalizeSession } from "@/lib/api";

// A failed finalize is never silently ignored.
//  - up to three automatic retries (2 s, then 4 s apart)
//  - if it still fails, an error screen with a retry button that asks the participant to contact the researcher
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 4_000];

const Complete = () => {
  const [status, setStatus] = useState<"working" | "done" | "error">("working");
  const [attempt, setAttempt] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const runIdRef = useRef(0);

  const finalize = async (runId: number) => {
    const participantCode = sessionStorage.getItem("participantCode");
    const sessionCode = sessionStorage.getItem("sessionCode");
    if (!participantCode || !sessionCode) {
      setStatus("error");
      setErrorMsg("Session info missing. Please re-enter your code.");
      return;
    }

    setStatus("working");
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (runIdRef.current !== runId) return; // stop if the page has unmounted
      try {
        // markProgress(complete) only tracks progress; if it fails, finalize still goes ahead.
        await markProgress(participantCode, "complete").catch(() => {});
        await finalizeSession(sessionCode);
        if (runIdRef.current !== runId) return;
        setStatus("done");
        return;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setErrorMsg(msg);
        if (i < MAX_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i] ?? 4_000));
        }
      }
    }
    if (runIdRef.current !== runId) return;
    setAttempt((prev) => prev + 1);
    setStatus("error");
  };

  useEffect(() => {
    runIdRef.current += 1;
    const runId = runIdRef.current;
    void finalize(runId);
    return () => {
      runIdRef.current += 1; // stop the running loop on unmount
    };
  }, []);

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-6 max-w-sm">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Almost done — one step left</h1>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Your responses were saved, but we could not finalize the session. Please retry. If
              this keeps happening, let the researcher know — your participation is still recorded.
            </p>
            {errorMsg && (
              <p className="text-xs text-muted-foreground font-mono mt-3 break-all">{errorMsg}</p>
            )}
          </div>
          <Button onClick={() => void finalize(runIdRef.current)} size="lg" className="w-full">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (status === "working") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-6 max-w-sm">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <div>
            <h1 className="text-xl font-semibold">Saving your responses…</h1>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Please wait while we finalize your participation.
            </p>
            {attempt > 0 && (
              <p className="text-xs text-muted-foreground mt-3">
                Retrying (attempt {attempt + 1})…
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-6 max-w-sm">
        <div className="w-16 h-16 rounded-full bg-status-success/10 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-status-success" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Thank You!</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Your participation in the experiment is now complete. Your responses have been recorded
            and will contribute to important research on human-AI collaboration.
          </p>
        </div>
        <div className="rounded-lg bg-muted/50 border p-4">
          <p className="text-xs text-muted-foreground">
            If you have any questions about this study, please contact the research team at{" "}
            <span className="text-primary font-medium">kimsumin@umich.edu</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Complete;
