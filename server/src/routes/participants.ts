// Participant routes.
// - PATCH /api/participants/:code/progress : mark a step as finished
// - GET   /api/participants/:code/state    : current state, used when a participant reconnects

import { Router } from "express";
import { Participant } from "../models/Participant.js";
import { GATE_ORDER, type ProgressStep } from "../types.js";

const router = Router();

const VALID_STEPS: ProgressStep[] = [
  "consent",
  "demographics",
  "infoCards",
  "preDiscussion",
  "waiting",
  "teamDecision",
  "postSurvey",
  "debrief",
  "complete",
];

// PATCH /api/participants/:code/progress
// body: { step: ProgressStep }
// Sets progress[step] = true.
router.patch("/:code/progress", async (req, res) => {
  try {
    const { code } = req.params;
    const { step } = req.body;

    if (!step || !VALID_STEPS.includes(step)) {
      return res
        .status(400)
        .json({ error: "invalid step", message: `step must be one of: ${VALID_STEPS.join(", ")}` });
    }

    // Partial update with $set.
    const participant = await Participant.findOneAndUpdate(
      { participantCode: code },
      { $set: { [`progress.${step}`]: true, lastSeenAt: new Date() } },
      { returnDocument: "after", lean: true },
    );
    if (!participant) {
      return res.status(404).json({ error: "participant_not_found" });
    }
    // Finishing the last step is the only place completedAt is set. The reconnect
    // logic checks it first, so a participant who reloads the final page stays there.
    // Only the first finish time is kept.
    if (step === "complete" && !participant.completedAt) {
      await Participant.updateOne(
        { participantCode: code, completedAt: { $exists: false } },
        { $set: { completedAt: new Date() } },
      );
    }
    res.json({ ok: true, progress: participant.progress });
  } catch (error) {
    console.error("[PATCH /participants/:code/progress]", error);
    res.status(500).json({ error: "server_error" });
  }
});

//PATCH /api/participants/:code/pre-choice
//body: { choice: Candidate }
router.patch("/:code/pre-choice", async (req, res) => {
  try {
    const { code } = req.params;
    const { choice } = req.body;

    const VALID_CHOICES = ["A", "B", "C", "D"];
    if (!choice || !VALID_CHOICES.includes(choice)) {
      return res.status(400).json({
        error: "invalid_choice",
        message: `choice must be one of: ${VALID_CHOICES.join(", ")}`,
      });
    }

    const participant = await Participant.findOneAndUpdate(
      { participantCode: code },
      { $set: { preDiscussionChoice: choice, lastSeenAt: new Date() } },
      { returnDocument: "after", lean: true },
    );
    if (!participant) {
      return res.status(404).json({ error: "participant_not_found" });
    }
    res.json({ ok: true, choice: participant.preDiscussionChoice });
  } catch (error) {
    console.error("[PATCH /participants/:code/pre-choice]", error);
    res.status(500).json({ error: "server_error" });
  }
});

// PATCH /api/participants/:code/gate-arrival  body: { gate: GateId }
// Called when the waiting (Hold) screen opens. Safe to repeat: a second call
// overwrites the time, and the dashboard only checks whether a time exists.
router.patch("/:code/gate-arrival", async (req, res) => {
  try {
    const { code } = req.params;
    const { gate } = req.body;

    if (!gate || !GATE_ORDER.includes(gate)) {
      return res
        .status(400)
        .json({ error: "invalid_gate", message: `gate must be one of: ${GATE_ORDER.join(", ")}` });
    }

    const participant = await Participant.findOneAndUpdate(
      { participantCode: code },
      { $set: { [`gateArrivals.${gate}`]: new Date(), lastSeenAt: new Date() } },
      { returnDocument: "after", lean: true },
    );
    if (!participant) {
      return res.status(404).json({ error: "participant_not_found" });
    }
    res.json({ ok: true, gateArrivals: participant.gateArrivals });
  } catch (error) {
    console.error("[PATCH /participants/:code/gate-arrival]", error);
    res.status(500).json({ error: "server_error" });
  }
});

// GET /api/participants/:code/state
// Called by the client on reconnect; returns progress and session details.
router.get("/:code/state", async (req, res) => {
  try {
    const { code } = req.params;

    // Load the participant with its session (sessionCode and conditionCode are needed).
    const participant = await Participant.findOne({ participantCode: code })
      .populate<{
        sessionId: {
          sessionCode: string;
          conditionCode: string;
          status: string;
          gateApprovals?: Record<string, Date>;
        };
      }>("sessionId", "sessionCode conditionCode status gateApprovals")
      .lean();
    if (!participant) {
      return res.status(404).json({ error: "participant_not_found" });
    }

    // Update lastSeenAt.
    Participant.updateOne({ participantCode: code }, { $set: { lastSeenAt: new Date() } }).catch(
      (error) => console.error("[lastSeenAt update failed]", error),
    );

    res.json({
      ok: true,
      state: {
        participantCode: participant.participantCode,
        role: participant.role,
        assignedProfile: participant.assignedProfile,
        sessionCode: participant.sessionId.sessionCode,
        conditionCode: participant.sessionId.conditionCode,
        sessionStatus: participant.sessionId.status ?? "waiting",
        approvals: participant.sessionId.gateApprovals ?? {}, // dates become ISO strings; the client only checks whether each is set
        progress: participant.progress,
        preDiscussionChoice: participant.preDiscussionChoice,
        completedAt: participant.completedAt,
      },
    });
  } catch (error) {
    console.error("[GET /participants/:code/state]", error);
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
