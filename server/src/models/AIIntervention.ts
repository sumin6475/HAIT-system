// AIIntervention — one row each time the server decides whether Alex speaks.
//
// A row is written whether Alex speaks or stays silent, so a session's rows
// explain every turn Alex took and every turn it passed on.

import mongoose from "mongoose";
import type { AIDecision, RouteKind } from "../types.js";

// One model call made while writing Alex's message: the first draft, or a
// rewrite after the draft broke a rule.
const outputRepairAttemptSchema = new mongoose.Schema(
  {
    stage: { type: String, enum: ["initial", "repair"], required: true },
    outcome: { type: String, enum: ["accepted", "rejected", "failed"], required: true },
    content: { type: String },
    responseId: { type: String },
    model: { type: String, required: true },
    latencyMs: { type: Number },
    inputTokens: { type: Number },
    outputTokens: { type: Number },
    systemFingerprint: { type: String },
    extractedTraitIds: { type: [String], default: undefined },
    violations: { type: [String], default: undefined },
    softViolations: { type: [String], default: undefined },
    error: { type: String },
  },
  { _id: false },
);

// The limits the draft was checked against: which candidate it had to stay on
// and which traits it was allowed to state.
const outputRepairGuardSchema = new mongoose.Schema(
  {
    candidate: { type: String, enum: ["A", "B", "C", "D"] },
    reason: { type: String, required: true },
    allowedTraitIds: { type: [String], default: undefined },
    requiredTraitId: { type: String },
  },
  { _id: false },
);

const outputRepairAuditSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    guard: { type: outputRepairGuardSchema, default: undefined },
    attempts: { type: [outputRepairAttemptSchema], required: true },
  },
  { _id: false },
);

const aiInterventionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },
    // The message sequence number this decision was made at.
    turnIndex: { type: Number, required: true },
    // What started the decision (a human message, a silence timer, the clock).
    triggerReason: { type: String, required: true },
    // The kind of turn the message was written as.
    cue: { type: String },
    decision: { type: String, enum: ["speak", "stay_silent"] as AIDecision[], required: true },
    // The saved chat message, when Alex spoke.
    generateMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },

    // The language-model call that wrote the message.
    responseId: { type: String },
    model: { type: String },
    response: { type: String },
    inputTokens: { type: Number },
    outputTokens: { type: Number },
    latencyMs: { type: Number },
    systemFingerprint: { type: String },

    routeKind: {
      type: String,
      enum: [
        "address",
        "followup",
        "long_silence",
        "build_on",
        "mediation",
        "backchannel",
        "greeting",
        "summary",
        "closing",
      ] as RouteKind[],
    },

    // How the decision was reached.
    source: { type: String },
    reservationId: { type: String },
    anchorSeq: { type: Number },
    priorityRoute: { type: String },
    priorityEvidence: { type: String },
    mainJudgeDecision: { type: String },
    judgeEvidence: { type: String },
    // The request Alex answered on this turn. Read back when the server
    // restarts, so Alex does not answer the same request twice.
    selectedOpportunityId: { type: String },
    selectedOpportunityAlexBroadcastSeq: { type: Number },
    decisionStage: { type: String },
    routeReason: { type: String },
    outcome: { type: String },
    silenceReason: { type: String },
    // Which compiled prompt the message was written with, for example "C2.build_on".
    promptKey: { type: String },

    // The stretch of conversation the message was written from, and the pause
    // before it was sent.
    contextFromSeq: { type: Number },
    contextToSeq: { type: Number },
    floorMs: { type: Number },

    generationSucceeded: { type: Boolean },
    interventionSaved: { type: Boolean },
    broadcastSucceeded: { type: Boolean },

    // The Chair's mediation state at the time of the turn.
    mediationLatched: { type: Boolean },
    mediationEvidence: { type: [String], default: undefined },
    buildOnsSinceMediation: { type: Number },

    // The output check: which candidate the message had to stay on, and
    // whether a rewrite was needed to keep it there.
    outputScopeCandidate: { type: String },
    outputScopeRepaired: { type: Boolean },
    outputScopeViolation: { type: String },

    // The candidate the conversation was focused on, and whether that focus
    // limited what the message could say. Never shown to participants.
    focusCandidate: { type: String, enum: ["A", "B", "C", "D"] },
    focusBasis: { type: String },
    focusHumanConfirmedCount: { type: Number },
    focusDepthThreshold: { type: Number },
    focusDirective: { type: String, enum: ["stay", "free"] },
    focusGuarded: { type: Boolean },
    internalMetadataRepaired: { type: Boolean },

    // What the latest human message asked Alex for.
    requestIntentKind: { type: String },
    requestIntentSource: { type: String },

    repairAudit: { type: outputRepairAuditSchema, default: undefined },

    // The error message when a model call failed.
    error: { type: String, default: "" },
  },
  { timestamps: true },
);

aiInterventionSchema.index({ sessionId: 1, turnIndex: 1 });
export const AIIntervention = mongoose.model("AIIntervention", aiInterventionSchema);
