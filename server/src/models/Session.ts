// Session — one experiment session. Every other collection points back to it
// through `sessionId`.
//
// `revealStats` is the board: which traits have been put in view, by whom, and
// first by whom. It is updated each time a message is saved, so the server can
// read the whole picture in one lookup instead of re-counting every message.

import mongoose from "mongoose";
import type { ConditionCode, SessionStatus, ProfileSlot, Candidate } from "../types.js";

// For one profile (X, Y or Z): how many of its traits have been put in view.
// "Unique" traits are on that card only; "shared" traits are on every card.
const profileStatsSchema = new mongoose.Schema(
  {
    uniqueRevealed: { type: Number, default: 0 },
    totalUnique: { type: Number, default: 0 },
    sharedRevealed: { type: Number, default: 0 },
    totalShared: { type: Number, default: 0 },
  },
  { _id: false },
);

// For one candidate: the trait ids a human participant has put in view.
const candidateStatsSchema = new mongoose.Schema(
  {
    revealedIds: { type: [String], default: [] },
  },
  { _id: false },
);

// Who put a trait in view first, and at which message. Separates a trait being
// contributed from the same trait being repeated later.
const firstBySchema = new mongoose.Schema(
  {
    by: { type: String, enum: ["human", "ai"], required: true },
    seq: { type: Number, required: true },
  },
  { _id: false },
);

const revealStatsSchema = new mongoose.Schema(
  {
    byProfile: {
      X: profileStatsSchema,
      Y: profileStatsSchema,
      Z: profileStatsSchema,
    },
    byCandidate: {
      A: candidateStatsSchema,
      B: candidateStatsSchema,
      C: candidateStatsSchema,
      D: candidateStatsSchema,
    },
    // Trait ids Alex has put in view.
    aiSurfacedIds: { type: [String], default: [] },
    // Trait ids a human participant has put in view.
    humanConfirmedIds: { type: [String], default: [] },
    // The candidate the humans were last talking about on their own.
    lastHumanDiscussion: {
      candidate: { type: String, enum: ["A", "B", "C", "D"] as Candidate[] },
      seq: Number,
    },
    // Keyed by trait id.
    firstBy: { type: Map, of: firstBySchema, default: undefined },
  },
  { _id: false },
);

// One timestamp per researcher-approval gate. Shared by
// `Session.gateApprovals` and `Participant.gateArrivals`.
const gateDatesSchema = new mongoose.Schema(
  {
    consent: Date,
    demographics: Date,
    infoCards: Date,
    waiting: Date,
    teamDecision: Date,
    debrief: Date,
  },
  { _id: false },
);

// Alex's state that has to survive a server restart. Short timers stay in
// memory; everything here is read back when the server starts again.
const aiStateSchema = new mongoose.Schema(
  {
    lifecycle: { type: String, enum: ["active", "closing", "muted"], default: "active" },
    closingReason: { type: String },
    closingAt: { type: Date },
    summaryStatus: {
      type: String,
      enum: ["not_eligible", "pending", "generating", "done"],
      default: "not_eligible",
    },
    summaryMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    // The closing message that was actually saved. Checked on restart so the
    // closing is never sent twice.
    closingMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    mediationLatched: { type: Boolean, default: false },
    mediationEvidence: { type: [String], default: [] },
    mediationLatchedAt: { type: Date },
    mediationLatchedHumanCount: { type: Number },
    buildOnsSinceMediation: { type: Number, default: 0 },
    buildOnFocusCandidate: { type: String, enum: ["A", "B", "C", "D"] },
    lastBackchannelAt: { type: Date },
    longSilenceBroadcastCount: { type: Number, default: 0 },
    lastLongSilenceAt: { type: Date },
    // Goes up by one with every human message. A reply that started before a
    // newer human message is checked against this and re-evaluated.
    conversationEpoch: { type: Number, default: 0 },
    // The latest human message whose request to Alex has been answered.
    interactionServedThroughEpoch: { type: Number, default: 0 },
  },
  { _id: false },
);

const sessionSchema = new mongoose.Schema(
  {
    // The code the researcher hands out, for example "S-C2-004".
    sessionCode: { type: String, required: true, unique: true, index: true },

    conditionCode: {
      type: String,
      enum: ["C1", "C2", "C3", "C4", "CTRL"] as ConditionCode[],
      required: true,
      index: true,
    },

    // The card Alex holds: "Z" in C1–C4, none in CTRL.
    aiProfile: { type: String, enum: ["X", "Y", "Z", null] as ProfileSlot[], default: null },

    status: {
      type: String,
      enum: ["waiting", "in_progress", "completed", "data_ready"] as SessionStatus[],
      default: "waiting",
      index: true,
    },

    startedAt: Date,
    endedAt: Date,

    // Each participant's final choice.
    teamDecision: { type: [String], enum: ["A", "B", "C", "D"] as Candidate[], default: [] },

    // Counter used to give each message its sequence number.
    seqCounter: { type: Number, default: 0 },

    // When the researcher approved each gate. A missing gate is not yet approved.
    gateApprovals: { type: gateDatesSchema, default: () => ({}) },

    // Whether the group chose the best candidate. Computed once, at the end.
    decisionAccuracy: {
      optimal: { type: String },
      // The shared choice, or the most common one; null on a tie.
      teamChoice: { type: String },
      correct: { type: Boolean },
      unanimous: { type: Boolean },
    },

    revealStats: {
      type: revealStatsSchema,
      default: () => ({ byCandidate: { A: {}, B: {}, C: {}, D: {} } }),
    },

    aiState: { type: aiStateSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export const Session = mongoose.model("Session", sessionSchema);
