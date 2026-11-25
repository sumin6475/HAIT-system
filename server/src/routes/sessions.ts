// Admin API for sessions.
//
// Endpoints:
//   POST   /api/sessions          create a session (condition + isTest)
//   GET    /api/sessions          list sessions
//   GET    /api/sessions/:code    one session with its participants
//   DELETE /api/sessions/:code    delete a session and everything that points to it
//
// Every request needs the x-admin-token header.

import { Router } from "express";
import { Session } from "../models/Session.js";
import { Participant } from "../models/Participant.js";
import { Message } from "../models/Message.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { ConversationObservation } from "../models/ConversationObservation.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import {
  generateNextSeq,
  buildSessionCode,
  buildParticipantCode,
  getParticipantSlots,
} from "../lib/codeGen.js";
import { computePoolingDV, computeDecisionAccuracy } from "../lib/poolingDV.js";
import { closeInterventionSession, stopInterventionSession } from "../lib/interventionEngine.js";
import { GATE_ORDER, type ConditionCode, type Candidate, type GateId } from "../types.js";
import { STATUS_CODES } from "http";

export const sessionsRouter = Router();

const VALID_CONDITIONS: ConditionCode[] = ["C1", "C2", "C3", "C4", "CTRL"];

// --- POST /api/sessions: create a session ---
// body: { conditionCode: "C1" | ..., isTest?: boolean }
// isTest defaults to true, so a study session number is never used up by mistake.
sessionsRouter.post("/", requireAdmin, async (req, res) => {
  try {
    const { conditionCode, isTest = true } = req.body as {
      conditionCode?: string;
      isTest?: boolean;
    };

    if (!conditionCode || !VALID_CONDITIONS.includes(conditionCode as ConditionCode)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid conditionCode. Use one of: ${VALID_CONDITIONS.join(", ")}`,
      });
    }

    const cond = conditionCode as ConditionCode;

    // 1. Next number (test and study prefixes count separately).
    const seq = await generateNextSeq(cond, isTest);

    // 2. Create the session.
    const sessionCode = buildSessionCode(cond, seq, isTest);
    const session = await Session.create({
      sessionCode,
      conditionCode: cond,
      aiProfile: cond === "CTRL" ? null : "Z",
      status: "waiting",
    });

    // 3. Create the participants (three for CTRL, two otherwise).
    const slots = getParticipantSlots(cond);
    const participants = await Participant.insertMany(
      slots.map((s) => ({
        sessionId: session._id,
        participantCode: buildParticipantCode(s.role, cond, seq, isTest),
        role: s.role,
        assignedProfile: s.profile,
      })),
    );

    res.json({
      ok: true,
      isTest,
      session: {
        sessionCode: session.sessionCode,
        conditionCode: session.conditionCode,
        status: session.status,
        createdAt: session.get("createdAt"),
      },
      participants: participants.map((p) => ({
        participantCode: p.participantCode,
        role: p.role,
        assignedProfile: p.assignedProfile,
      })),
    });
  } catch (error) {
    console.error("[POST /api/sessions]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

// --- GET /api/sessions: list ---
sessionsRouter.get("/", requireAdmin, async (_req, res) => {
  try {
    const sessions = await Session.find().sort({ createdAt: -1 }).lean();

    // For each session: how many participants, and who has reached each gate.
    const sessionsWithCount = await Promise.all(
      sessions.map(async (s) => {
        const parts = await Participant.find({ sessionId: s._id }).select("gateArrivals").lean();
        return {
          sessionCode: s.sessionCode,
          conditionCode: s.conditionCode,
          status: s.status,
          isTest: s.sessionCode.startsWith("T-"),
          participantCount: parts.length,
          gates: {
            approvals: s.gateApprovals ?? {},
            arrivals: Object.fromEntries(
              GATE_ORDER.map((g) => [g, parts.filter((p) => p.gateArrivals?.[g]).length]),
            ),
          },
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          createdAt: s.createdAt,
        };
      }),
    );

    res.json({ ok: true, sessions: sessionsWithCount });
  } catch (error) {
    console.error("[GET /api/sessions]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

// --- GET /api/sessions/:code: one session with its participants ---
sessionsRouter.get("/:code", requireAdmin, async (req, res) => {
  try {
    const session = await Session.findOne({ sessionCode: req.params.code }).lean();
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    const participants = await Participant.find({ sessionId: session._id })
      .sort({ assignedProfile: 1 })
      .lean();

    const messages = await Message.find({ sessionId: session._id }).sort({ seq: 1 }).lean();

    res.json({
      ok: true,
      session: {
        sessionCode: session.sessionCode,
        conditionCode: session.conditionCode,
        status: session.status,
        isTest: session.sessionCode.startsWith("T-"),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        createdAt: session.createdAt,
        aiState: (session as any).aiState ?? null,
        // The board: which traits are in view and who put them there.
        revealStats: (session as any).revealStats ?? null,
      },
      participants: participants.map((p) => ({
        participantCode: p.participantCode,
        role: p.role,
        assignedProfile: p.assignedProfile,
        lastSeenAt: p.lastSeenAt,
      })),
      messages: messages.map((m) => ({
        seq: m.seq,
        sender: m.sender,
        senderRole: m.senderRole,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    console.error("[GET /api/sessions/:code]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

// --- GET /api/sessions/:code/export: everything about one session ---
// Used by the dashboard's download. Includes every Alex decision, spoken or silent.
sessionsRouter.get("/:code/export", requireAdmin, async (req, res) => {
  try {
    const session = await Session.findOne({ sessionCode: req.params.code }).lean();
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    const participants = await Participant.find({ sessionId: session._id })
      .sort({ assignedProfile: 1 })
      .lean();
    const messages = await Message.find({ sessionId: session._id }).sort({ seq: 1 }).lean();
    const [interventions, conversationObservations] = await Promise.all([
      AIIntervention.find({ sessionId: session._id }).sort({ turnIndex: 1, createdAt: 1 }).lean(),
      ConversationObservation.find({ sessionId: session._id }).sort({ anchorSeq: 1 }).lean(),
    ]);

    res.json({
      ok: true,
      session: {
        sessionCode: session.sessionCode,
        conditionCode: session.conditionCode,
        status: session.status,
        isTest: session.sessionCode.startsWith("T-"),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        createdAt: session.createdAt,
        aiState: (session as any).aiState ?? null,
      },
      participants: participants.map((p) => ({
        participantCode: p.participantCode,
        role: p.role,
        assignedProfile: p.assignedProfile,
      })),
      messages: messages.map((m) => ({
        seq: m.seq,
        sender: m.sender,
        senderRole: m.senderRole,
        content: m.content,
        createdAt: m.createdAt,
        sharedInfoIds: m.sharedInfoIds,
      })),
      interventions: interventions.map((i) => ({
        turnIndex: i.turnIndex,
        decision: i.decision,
        triggerReason: i.triggerReason,
        cue: i.cue,
        routeKind: i.routeKind,
        source: i.source,
        reservationId: i.reservationId,
        anchorSeq: i.anchorSeq,
        priorityRoute: i.priorityRoute,
        priorityEvidence: i.priorityEvidence,
        mainJudgeDecision: i.mainJudgeDecision,
        judgeEvidence: i.judgeEvidence,
        selectedOpportunityId: i.selectedOpportunityId,
        selectedOpportunityAlexBroadcastSeq: i.selectedOpportunityAlexBroadcastSeq,
        decisionStage: i.decisionStage,
        routeReason: i.routeReason,
        outcome: i.outcome,
        silenceReason: i.silenceReason,
        promptKey: i.promptKey,
        contextFromSeq: i.contextFromSeq,
        contextToSeq: i.contextToSeq,
        floorMs: i.floorMs,
        generationSucceeded: i.generationSucceeded,
        interventionSaved: i.interventionSaved,
        broadcastSucceeded: i.broadcastSucceeded,
        mediationLatched: i.mediationLatched,
        mediationEvidence: i.mediationEvidence,
        buildOnsSinceMediation: i.buildOnsSinceMediation,
        focusCandidate: i.focusCandidate,
        focusBasis: i.focusBasis,
        focusHumanConfirmedCount: i.focusHumanConfirmedCount,
        focusDepthThreshold: i.focusDepthThreshold,
        focusDirective: i.focusDirective,
        focusGuarded: i.focusGuarded,
        internalMetadataRepaired: i.internalMetadataRepaired,
        outputScopeCandidate: i.outputScopeCandidate,
        outputScopeRepaired: i.outputScopeRepaired,
        outputScopeViolation: i.outputScopeViolation,
        requestIntentKind: i.requestIntentKind,
        requestIntentSource: i.requestIntentSource,
        repairAudit: i.repairAudit,
        model: i.model,
        responseId: i.responseId,
        systemFingerprint: i.systemFingerprint,
        latencyMs: i.latencyMs,
        inputTokens: i.inputTokens,
        outputTokens: i.outputTokens,
        error: i.error,
        createdAt: (i as any).createdAt,
      })),
      conversationObservations: conversationObservations.map((observation: any) => ({
        anchorSeq: observation.anchorSeq,
        conversationEpoch: observation.conversationEpoch,
        mode: observation.mode,
        participantRoster: observation.participantRoster,
        ledgerDelta: observation.ledgerDelta,
        ledgerTransition: observation.ledgerTransition,
        ledgerStateAfter: observation.ledgerStateAfter,
        observerCallAttempts: observation.observerCallAttempts,
        ledgerJudgeDecision: observation.ledgerJudgeDecision,
        ledgerJudgeAttempts: observation.ledgerJudgeAttempts,
        ledgerJudgeReobserved: observation.ledgerJudgeReobserved,
        ledgerBroadcastTransition: observation.ledgerBroadcastTransition,
        repairCodes: observation.repairCodes,
        conflictCodes: observation.conflictCodes,
        degradedMode: observation.degradedMode,
        addressees: observation.addressees,
        replyToSeq: observation.replyToSeq,
        speechAct: observation.speechAct,
        activeCandidates: observation.activeCandidates,
        mentionedCandidates: observation.mentionedCandidates,
        scopeCandidates: observation.scopeCandidates,
        focusCandidate: observation.focusCandidate,
        focusBasis: observation.focusBasis,
        threadGoal: observation.threadGoal,
        requestedScope: observation.requestedScope,
        requestExplicitness: observation.requestExplicitness,
        transitionState: observation.transitionState,
        relationToPendingAlexQuestion: observation.relationToPendingAlexQuestion,
        expectedHumanResponder: observation.expectedHumanResponder,
        conversationPhase: observation.conversationPhase,
        alexRelation: observation.alexRelation,
        activeThread: observation.activeThread,
        floor: observation.floor,
        fieldConfidence: observation.fieldConfidence,
        observerReviewed: observation.observerReviewed,
        confidence: observation.confidence,
        explicitAlexDefer: observation.explicitAlexDefer,
        explicitAlexDeferEvidence: observation.explicitAlexDeferEvidence,
        pendingQuestionRootSeq: observation.pendingQuestionRootSeq,
        questionThreadAfter: observation.questionThreadAfter,
        stateAfter: observation.stateAfter,
        model: observation.model,
        responseId: observation.responseId,
        latencyMs: observation.latencyMs,
        error: observation.error,
        createdAt: observation.createdAt,
        updatedAt: observation.updatedAt,
      })),
    });
  } catch (error) {
    console.error("[GET /api/sessions/:code/export]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

// --- DELETE /api/sessions/:code: delete a session and everything that points to it ---
sessionsRouter.delete("/:code", requireAdmin, async (req, res) => {
  try {
    const session = await Session.findOne({ sessionCode: req.params.code });
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    //cascade: Participant + Message + AIIntervention + ConversationObservation + Session
    const [pDel, mDel, aiDel, observationDel] = await Promise.all([
      Participant.deleteMany({ sessionId: session._id }),
      Message.deleteMany({ sessionId: session._id }),
      AIIntervention.deleteMany({ sessionId: session._id }),
      ConversationObservation.deleteMany({ sessionId: session._id }),
    ]);
    await session.deleteOne();

    res.json({
      ok: true,
      deleted: {
        sessionCode: req.params.code,
        participants: pDel.deletedCount,
        messages: mDel.deletedCount,
        aiInterventions: aiDel.deletedCount,
        conversationObservations: observationDel.deletedCount,
      },
    });
  } catch (error) {
    console.error("[DELETE /api/sessions/:code]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

// --- PATCH /api/sessions/:code/gates/:gate/approve: approve a gate ---
// The researcher clicks on the dashboard; each participant's waiting screen checks
// every 2.5 seconds and moves on. There is no status check here, so the researcher
// can always move a session along; the dashboard decides when to offer the button.
sessionsRouter.patch("/:code/gates/:gate/approve", requireAdmin, async (req, res) => {
  try {
    const { code, gate } = req.params;
    if (!GATE_ORDER.includes(gate as GateId)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid gate. Use one of: ${GATE_ORDER.join(", ")}`,
      });
    }

    const session = await Session.findOne({ sessionCode: code }).lean();
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    // Already approved: return ok (safe against double clicks).
    if (session.gateApprovals?.[gate as GateId]) {
      return res.json({ ok: true, approvals: session.gateApprovals });
    }

    const updated = await Session.findOneAndUpdate(
      { sessionCode: code },
      { $set: { [`gateApprovals.${gate}`]: new Date() } },
      { returnDocument: "after", lean: true },
    );
    console.log(`[approve-gate] ${gate} approved for ${code}`);
    res.json({ ok: true, approvals: updated?.gateApprovals ?? {} });
  } catch (error) {
    console.error("[PATCH /api/sessions/:code/gates/:gate/approve]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

// --- POST /api/sessions/:code/stop-ai: researcher stop switch (mutes Alex) ---
// Mutes Alex for this session for good. The humans, the chat and the timer carry
// on. It does not end the discussion (that is the Exit button). No status check,
// so it always works.
sessionsRouter.post("/:code/stop-ai", requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const session = await Session.findOne({ sessionCode: code });
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }
    await closeInterventionSession(session.sessionCode);
    console.log(`[stop-ai] AI muted by researcher for ${session.sessionCode}`);
    res.json({ ok: true, sessionCode: session.sessionCode, muted: true });
  } catch (error) {
    console.error("[POST /api/sessions/:code/stop-ai]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

// --- PATCH /api/sessions/:code/team-decision: a participant's final choice ---
// body: { teamDecision: "A" | "B" | "C" | "D" }
sessionsRouter.patch("/:code/team-decision", async (req, res) => {
  try {
    const { code } = req.params;
    const { participantCode, decision } = req.body as {
      participantCode?: string;
      decision?: string;
    };
    if (!participantCode) {
      return res.status(400).json({ ok: false, error: "participantCode is required" });
    }
    if (!decision || !["A", "B", "C", "D"].includes(decision)) {
      return res.status(400).json({ ok: false, error: "Invalid team decision (must be A/B/C/D)" });
    }

    const session = await Session.findOne({ sessionCode: code });
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    // Only allowed while the session is in_progress or completed.
    if (session.status !== "in_progress") {
      return res.status(400).json({
        ok: false,
        error: `Cannot submit team-decision in status="${session.status}"`,
      });
    }

    // Claim the participant's choice atomically, so a double click cannot submit twice.
    // This only succeeds while teamDecisionChoice is empty; otherwise it returns null and
    // the route answers 409. (In MongoDB, { teamDecisionChoice: null } matches both a
    // missing field and an explicit null.)
    const claimed = await Participant.findOneAndUpdate(
      { sessionId: session._id, participantCode, teamDecisionChoice: null },
      { $set: { teamDecisionChoice: decision as Candidate } },
      { returnDocument: "after" },
    );
    if (!claimed) {
      const exists = await Participant.findOne({ sessionId: session._id, participantCode });
      if (!exists) {
        return res.status(404).json({ ok: false, error: "Participant not found" });
      }
      return res.status(409).json({ ok: false, error: "Team decision already submitted" });
    }

    // Agreement check: if a choice was already submitted, this one must match.
    // If it does not, undo the claim and return 409; the participant stays on the
    // team-decision page and submits again.
    const currentSession = await Session.findOne({ sessionCode: code }).lean();
    if (!currentSession) {
      await Participant.updateOne({ _id: claimed._id }, { $unset: { teamDecisionChoice: 1 } });
      return res.status(500).json({ ok: false, error: "Session disappeared after claim" });
    }
    const existingDecisions = currentSession.teamDecision ?? [];
    if (existingDecisions.length > 0 && existingDecisions[0] !== decision) {
      await Participant.updateOne({ _id: claimed._id }, { $unset: { teamDecisionChoice: 1 } });
      return res.status(409).json({
        ok: false,
        error: "team_decision_mismatch",
        message: "Your team submitted different decisions. Please reach a consensus and resubmit.",
      });
    }

    // Append to Session.teamDecision with an atomic $push instead of read-then-write.
    // It only appends on the first submission or when the value matches the one
    // already there, so two different first submissions at the same moment still
    // cannot both get in.
    const updated = await Session.findOneAndUpdate(
      {
        sessionCode: code,
        status: "in_progress",
        $or: [{ teamDecision: { $size: 0 } }, { teamDecision: decision as Candidate }],
      },
      { $push: { teamDecision: decision as Candidate } },
      { returnDocument: "after", lean: true },
    );
    if (!updated) {
      await Participant.updateOne(
        { _id: claimed._id, teamDecisionChoice: decision as Candidate },
        { $unset: { teamDecisionChoice: 1 } },
      );
      const fresh = await Session.findOne({ sessionCode: code }).lean();
      if (!fresh) {
        return res.status(500).json({ ok: false, error: "Session disappeared after claim" });
      }
      if ((fresh.teamDecision ?? []).some((value) => value !== decision)) {
        return res.status(409).json({
          ok: false,
          error: "team_decision_mismatch",
          message:
            "Your team submitted different decisions. Please reach a consensus and resubmit.",
        });
      }
      return res.status(409).json({ ok: false, error: "Team decision already closed" });
    }

    // Mark the session completed only once everyone has submitted (a conditional update succeeds once).
    const expected = updated.conditionCode === "CTRL" ? 3 : 2;
    const submittedCount = updated.teamDecision.length;

    let transitioned = false;
    let finalStatus: string = updated.status;
    let finalTeamDecision: Candidate[] = updated.teamDecision;
    if (submittedCount >= expected) {
      // Store the pooling measures at completion. A fresh read picks up the latest sets
      // from background extraction; the underlying sets stay as they are.
      const fresh = await Session.findById(session._id).select("revealStats").lean();
      // Decision accuracy: did the group choose the pooled answer, C?
      const decisionAccuracy = computeDecisionAccuracy(updated.teamDecision ?? []);
      const completedDoc = await Session.findOneAndUpdate(
        { _id: session._id, status: "in_progress" },
        {
          $set: {
            status: "completed",
            endedAt: new Date(),
            "revealStats.byProfile": computePoolingDV((fresh as any)?.revealStats),
            decisionAccuracy,
          },
        },
        { returnDocument: "after", lean: true },
      );
      if (completedDoc) {
        transitioned = true;
        finalStatus = "completed";
        finalTeamDecision = completedDoc.teamDecision;
      }
    }

    if (transitioned) {
      console.log(
        `[sessions] ${code} status: in_progress -> completed (all ${expected} submitted)`,
      );
      await stopInterventionSession(session.sessionCode);
    }

    res.json({
      ok: true,
      sessionCode: session.sessionCode,
      teamDecision: finalTeamDecision,
      status: finalStatus,
      submittedCount,
      expected,
    });
  } catch (error) {
    console.error("[PATCH /api/sessions/:code/team-decision]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

// --- PATCH /api/participants/:code/finalize ---
// Called after the post-survey and debrief.
// status: completed -> data_ready
sessionsRouter.patch("/:code/finalize", async (req, res) => {
  try {
    const { code } = req.params;
    const session = await Session.findOne({ sessionCode: code });
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    // Already data_ready: return it as is (safe to repeat).
    if (session.status === "data_ready") {
      return res.json({
        ok: true,
        sessionCode: session.sessionCode,
        status: session.status,
      });
    }

    // Conditional update: if both participants finalize at once, completed -> data_ready still happens only once.
    const updated = await Session.findOneAndUpdate(
      { sessionCode: code, status: "completed" },
      { $set: { status: "data_ready" } },
      { returnDocument: "after", lean: true },
    );
    if (updated) {
      return res.json({
        ok: true,
        sessionCode: updated.sessionCode,
        status: updated.status,
      });
    }

    // No change means the status was not completed (another request won, or the session has not completed yet).
    const fresh = await Session.findOne({ sessionCode: code }).lean();
    if (!fresh) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }
    if (fresh.status === "data_ready") {
      return res.json({ ok: true, sessionCode: fresh.sessionCode, status: fresh.status });
    }
    return res.status(409).json({
      ok: false,
      error: `Cannot finalize in status="${fresh.status}"`,
    });
  } catch (error) {
    console.error("[PATCH /api/sessions/:code/finalize]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});
