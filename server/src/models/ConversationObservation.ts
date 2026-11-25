// ConversationObservation: one row per human message, written by the Observer.
//
// Each row holds the Observer's reading of the conversation at that message
// (who is addressed, which thread is active, who holds the floor, what was
// asked of Alex) and the conversation ledger after it. The controller reads the
// previous row back on every turn, so this is the working memory Alex's turn
// decisions are built on.
//
// The rows also form a turn-by-turn record of how the conversation was read.
// Future studies could use them to analyse threading, addressing, and floor
// changes in group discussion with an AI participant.

import mongoose from "mongoose";
import type { Candidate, ParticipantRole } from "../types.js";

const questionThreadSnapshotSchema = new mongoose.Schema(
  {
    rootSeq: { type: Number, required: true },
    state: {
      type: String,
      enum: ["waiting_for_answer", "collecting_answers", "uptake_eligible", "closed"],
      required: true,
    },
    candidates: { type: [String], enum: ["A", "B", "C", "D"] as Candidate[] },
    evidenceSeqs: { type: [Number], default: [] },
    responders: {
      type: [String],
      enum: ["humanX", "humanY", "humanZ"] as ParticipantRole[],
      default: [],
    },
    closeReason: { type: String },
  },
  { _id: false },
);

const pendingAlexObligationSchema = new mongoose.Schema(
  {
    rootSeq: { type: Number, required: true },
    rootEpoch: { type: Number, required: true },
    kind: {
      type: String,
      enum: ["answer_request", "compare_request", "narrow_decision_request"],
      required: true,
    },
    requestedScope: {
      type: String,
      enum: ["none", "single_point", "single_candidate", "multiple_candidates", "whole_board"],
      required: true,
    },
    candidates: { type: [String], enum: ["A", "B", "C", "D"] as Candidate[], default: [] },
  },
  { _id: false },
);

const activeThreadSchema = new mongoose.Schema(
  {
    threadId: { type: String, required: true },
    rootSeq: { type: Number, required: true },
    status: { type: String, enum: ["open", "waiting", "resolved", "superseded"], required: true },
    goal: {
      type: String,
      enum: [
        "answer_question",
        "compare_information",
        "share_information",
        "evaluate_candidates",
        "narrow_decision",
        "acknowledge",
        "other",
      ],
      required: true,
    },
    requestedAction: { type: String, default: "" },
    requestedScope: {
      type: String,
      enum: ["none", "single_point", "single_candidate", "multiple_candidates", "whole_board"],
      required: true,
    },
    candidates: { type: [String], enum: ["A", "B", "C", "D"] as Candidate[], default: [] },
    participants: { type: [String], default: [] },
    expectedResponders: { type: [String], default: [] },
    alexParticipation: {
      type: String,
      enum: ["required", "invited", "relevant", "not_involved"],
      required: true,
    },
    evidenceSeqs: { type: [Number], default: [] },
  },
  { _id: false },
);

const floorSchema = new mongoose.Schema(
  {
    holder: { type: String, enum: ["alex", "humanX", "humanY", "humanZ", "open", "unclear"] },
    expectedNext: { type: [String], default: [] },
    transition: { type: String, enum: ["available", "held", "unclear"] },
  },
  { _id: false },
);

const conversationStateAfterSchema = new mongoose.Schema(
  {
    observedThroughSeq: { type: Number, required: true },
    observedThroughEpoch: { type: Number, required: true },
    pendingAlexObligation: { type: pendingAlexObligationSchema, default: undefined },
    obligationCloseReason: {
      type: String,
      enum: ["topic_shift", "human_closure", "thread_resolved", "thread_superseded"],
    },
    expectedHumanResponder: {
      type: String,
      enum: ["humanX", "humanY", "humanZ"] as ParticipantRole[],
    },
    transitionState: {
      type: String,
      enum: ["mid_thread", "transition_available", "unclear"],
      required: true,
    },
    conversationPhase: {
      type: String,
      enum: ["opening", "exploration", "comparison", "deliberation", "decision", "closing"],
      required: true,
    },
    alexRelation: {
      type: String,
      enum: [
        "explicit_addressee",
        "group_participant",
        "response_to_alex",
        "about_alex",
        "unrelated",
        "uncertain",
      ],
      required: true,
    },
    activeThread: { type: activeThreadSchema, default: undefined },
    floor: { type: floorSchema, required: true },
    mentionedCandidates: { type: [String], enum: ["A", "B", "C", "D"], default: undefined },
    scopeCandidates: { type: [String], enum: ["A", "B", "C", "D"], default: undefined },
    focusCandidate: { type: String, enum: ["A", "B", "C", "D"] },
    focusBasis: {
      type: String,
      enum: ["current_explicit", "carried_thread", "multiple_explicit", "none"],
    },
  },
  { _id: false },
);

const conversationObservationSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },
    anchorSeq: { type: Number, required: true },
    conversationEpoch: { type: Number },
    requestIntent: { type: mongoose.Schema.Types.Mixed, default: null },
    opportunityTransitions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    mode: { type: String, enum: ["shadow", "active"], default: "active" },
    participantRoster: { type: [String], default: undefined },
    // The ledger's change, transition and state after this message, stored as
    // plain objects exactly as the reducer produced them.
    ledgerDelta: { type: mongoose.Schema.Types.Mixed, default: undefined },
    ledgerTransition: { type: mongoose.Schema.Types.Mixed, default: undefined },
    ledgerStateAfter: { type: mongoose.Schema.Types.Mixed, default: undefined },
    observerCallAttempts: { type: mongoose.Schema.Types.Mixed, default: undefined },
    ledgerJudgeVersion: { type: String },
    ledgerJudgePromptVersion: { type: String },
    ledgerJudgeSchemaVersion: { type: String },
    ledgerJudgeDecision: { type: mongoose.Schema.Types.Mixed, default: undefined },
    ledgerJudgeAttempts: { type: mongoose.Schema.Types.Mixed, default: undefined },
    ledgerJudgeReobserved: { type: Boolean },
    ledgerBroadcastTransition: { type: mongoose.Schema.Types.Mixed, default: undefined },
    repairCodes: { type: [String], default: undefined },
    conflictCodes: { type: [String], default: undefined },
    degradedMode: { type: Boolean, default: false },

    addressees: {
      type: [String],
      enum: ["alex", "humanX", "humanY", "humanZ", "group"],
      default: undefined,
    },
    replyToSeq: { type: Number },
    speechAct: {
      type: String,
      enum: [
        "question",
        "answer",
        "proposal",
        "agreement",
        "defer",
        "topic_shift",
        "closure",
        "other",
      ],
    },
    activeCandidates: {
      type: [String],
      enum: ["A", "B", "C", "D"] as Candidate[],
      default: undefined,
    },
    mentionedCandidates: { type: [String], enum: ["A", "B", "C", "D"], default: undefined },
    scopeCandidates: { type: [String], enum: ["A", "B", "C", "D"], default: undefined },
    focusCandidate: { type: String, enum: ["A", "B", "C", "D"] },
    focusBasis: {
      type: String,
      enum: ["current_explicit", "carried_thread", "multiple_explicit", "none"],
    },
    threadGoal: {
      type: String,
      enum: ["compare", "answer_question", "decide", "other"],
    },
    requestedScope: {
      type: String,
      enum: ["none", "single_point", "single_candidate", "multiple_candidates", "whole_board"],
    },
    requestExplicitness: {
      type: String,
      enum: ["none", "implicit", "explicit"],
    },
    transitionState: {
      type: String,
      enum: ["mid_thread", "transition_available", "unclear"],
    },
    relationToPendingAlexQuestion: {
      type: String,
      enum: ["direct_answer", "related_addition", "unrelated", "uncertain"],
    },
    expectedHumanResponder: {
      type: String,
      enum: ["humanX", "humanY", "humanZ"],
    },
    confidence: { type: Number },
    conversationPhase: {
      type: String,
      enum: ["opening", "exploration", "comparison", "deliberation", "decision", "closing"],
    },
    alexRelation: {
      type: String,
      enum: [
        "explicit_addressee",
        "group_participant",
        "response_to_alex",
        "about_alex",
        "unrelated",
        "uncertain",
      ],
    },
    activeThread: { type: activeThreadSchema, default: undefined },
    floor: { type: floorSchema, default: undefined },
    fieldConfidence: {
      threading: { type: Number },
      addressee: { type: Number },
      floor: { type: Number },
      alexRelation: { type: Number },
    },
    observerReviewed: { type: Boolean, default: false },
    explicitAlexDefer: { type: Boolean, default: false },
    explicitAlexDeferEvidence: { type: String },

    pendingQuestionRootSeq: { type: Number },
    questionThreadAfter: { type: questionThreadSnapshotSchema, default: undefined },
    stateAfter: { type: conversationStateAfterSchema, default: undefined },
    model: { type: String },
    responseId: { type: String },
    latencyMs: { type: Number },
    error: { type: String },
  },
  { timestamps: true },
);

conversationObservationSchema.index({ sessionId: 1, anchorSeq: 1 }, { unique: true });

export const ConversationObservation = mongoose.model(
  "ConversationObservation",
  conversationObservationSchema,
);
