// The shared waiting screen for researcher approval: /chat/hold/:gateId.
// On mount it records the arrival (without waiting for the reply), then checks
// every 2.5 seconds for approval and moves on. All six gates use this one screen;
// the differences live in gates.ts.

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Hourglass } from "lucide-react";
import { getParticipantState, markGateArrival } from "@/lib/api";
import { gateById, gateOpen, type GateId } from "@/lib/gates";

const POLL_INTERVAL_MS = 2500;

const Hold = () => {
  const navigate = useNavigate();
  const { gateId } = useParams();
  const [dots, setDots] = useState(0);
  const [checkedOnce, setCheckedOnce] = useState(false);

  const gate = gateId ? gateById(gateId) : undefined;
  const participantCode = sessionStorage.getItem("participantCode") ?? "";

  useEffect(() => {
    if (!gate || !participantCode) {
      navigate("/chat");
      return;
    }

    // Record the arrival. If it fails, waiting and checking carry on anyway.
    markGateArrival(participantCode, gate.id as GateId).catch((error) => {
      console.error("[Hold] markGateArrival failed:", error);
    });

    let cancelled = false;
    const check = async () => {
      try {
        const state = await getParticipantState(participantCode);
        if (cancelled) return;
        setCheckedOnce(true);
        if (state.completedAt) {
          navigate("/chat/complete", { replace: true });
          return;
        }
        // If the session has already started (for example, a reload just after the discussion gate was approved), go straight to the room.
        if (gate.id === "waiting" && state.sessionStatus === "in_progress") {
          navigate("/chat/room", { replace: true });
          return;
        }
        if (gateOpen(gate.id, state.approvals)) {
          navigate(gate.nextPath, { replace: true });
        }
      } catch (error) {
        console.error("[Hold] state poll failed:", error);
      }
    };

    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateId]);

  // Dots animation (same as WaitingRoom).
  useEffect(() => {
    const i = setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(i);
  }, []);

  if (!gate) return null;

  // Only a spinner before the first check (a one-frame flash is fine when already approved or disabled).
  if (!checkedOnce) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm text-center space-y-8">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <Hourglass className="w-8 h-8 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Please wait</h1>
          <p className="text-sm text-muted-foreground mt-2">
            The researcher will start the next part shortly{".".repeat(dots)}
          </p>
        </div>

        <div className="space-y-3 bg-card rounded-xl border p-6">
          <p className="text-sm">
            Next: <span className="font-medium">{gate.nextLabel}</span>
          </p>
          {gate.holdNote && <p className="text-xs text-muted-foreground">{gate.holdNote}</p>}
        </div>

        <p className="text-xs text-muted-foreground font-mono">{participantCode}</p>
      </div>
    </div>
  );
};

export default Hold;
