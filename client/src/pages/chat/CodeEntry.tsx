import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveResumePath } from "@/lib/resumeRouter";
import { getParticipantState } from "@/lib/api";

// Participant code format:
//   study: P-X-C1-001, P-Y-CTRL-001
//   test:  TP-X-C1-001, TP-Z-CTRL-001
const CODE_PATTERN = /^T?P-[XYZ]-(C[1-4]|CTRL)-\d{3}$/;

const CodeEntry = () => {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [autoFilled, setAutoFilled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  // Fill in the code from ?code=... in the URL (when the participant follows the link the researcher sent).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get("code");
    if (codeParam) {
      setCode(codeParam.toUpperCase());
      setAutoFilled(true);
    }
  }, []);

  const validateCode = (c: string) => CODE_PATTERN.test(c);

  // Parse the code and store it in sessionStorage.
  // Example: TP-X-C1-001 -> { role: "humanX", condition: "C1", isTest: true, seq: "001", sessionCode: "T-C1-001" }
  const parseAndStore = (raw: string) => {
    const upper = raw.toUpperCase();
    //prefix(T?P), slot, condition, seq
    const parts = upper.split("-");
    // TP-X-C1-001 -> ["TP","X","C1","001"]
    // P-X-C1-001  -> ["P","X","C1","001"]
    const isTest = parts[0] === "TP";
    const slot = parts[1]; //X|Y|Z
    const condition = parts[2]; //C1|C2|C3|C4|CTRL
    const seq = parts[3];
    const sessionPrefix = isTest ? "T" : "S";
    const sessionCode = `${sessionPrefix}-${condition}-${seq}`;
    const role = `human${slot}`;

    sessionStorage.setItem("participantCode", upper);
    sessionStorage.setItem("sessionCode", sessionCode);
    sessionStorage.setItem("condition", condition);
    sessionStorage.setItem("role", role);
    sessionStorage.setItem("assignedProfile", slot);
    sessionStorage.setItem("isTest", String(isTest));
  };

  const handleSubmit = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError("Please enter your participant code.");
      return;
    }
    if (!validateCode(trimmed)) {
      setError("Invalid code format. Example: P-X-C1-001");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      // Look up the participant's state to decide where to continue.
      const state = await getParticipantState(trimmed);

      // Store, then route.
      parseAndStore(trimmed);
      // Store the condition under "conditionCode", the key WaitingRoom reads, taken from the server's state.
      sessionStorage.setItem("conditionCode", state.conditionCode);
      sessionStorage.setItem("assignedProfile", state.role.replace("human", ""));
      const nextPath = resolveResumePath(state);
      navigate(nextPath);
    } catch (error) {
      console.error("[CodeEntry] getParticipantState failed:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      // participant_not_found: the code is well formed but not in the database
      if (message === "participant_not_found") {
        setError("Code not found. Please contact the research team.");
      } else {
        setError("Could not connect to the server. Please try again.");
      }
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8">
        <div className="flex flex-col items-center gap-6">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <FlaskConical className="w-7 h-7 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">HAIT Experiment</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {autoFilled
                ? "Your code has been filled in. Please confirm and continue."
                : "Enter your participant code to begin"}
            </p>
          </div>
          <div className="w-full space-y-4">
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="P-X-C1-001"
              className={cn(
                "w-full rounded-lg border bg-card px-4 py-3 text-center font-mono text-lg tracking-widest placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring",
                error ? "border-destructive focus:ring-destructive" : "border-input",
              )}
            />
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button onClick={handleSubmit} className="w-full" size="lg" disabled={submitting}>
              {submitting ? "Checking..." : "Continue"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center max-w-xs">
            Your code was provided by the research team.
          </p>
        </div>
      </div>
    </div>
  );
};

export default CodeEntry;
