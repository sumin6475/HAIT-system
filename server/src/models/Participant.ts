// Participant — one human in a session.
//
// The surveys themselves run outside this app; this record keeps the
// participant's role, their choices, and how far through the study flow they are.

import mongoose from "mongoose";
import type { ParticipantRole, ProfileSlot, Candidate } from "../types.js";

// Which steps of the study flow the participant has finished. Used to send a
// participant back to the right page when they reconnect.
const progressSchema = new mongoose.Schema(
  {
    consent: { type: Boolean, default: false },
    demographics: { type: Boolean, default: false },
    infoCards: { type: Boolean, default: false },
    preDiscussion: { type: Boolean, default: false },
    waiting: { type: Boolean, default: false },
    teamDecision: { type: Boolean, default: false },
    postSurvey: { type: Boolean, default: false },
    debrief: { type: Boolean, default: false },
    complete: { type: Boolean, default: false },
  },
  { _id: false },
);

// When the participant reached each researcher-approval gate. Same shape as
// `Session.gateApprovals`. Kept apart from `progress`: progress says a step was
// finished, an arrival says the participant is now waiting at the gate.
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

const participantSchema = new mongoose.Schema(
  {
    participantCode: { type: String, required: true, index: true, unique: true },

    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },

    role: {
      type: String,
      enum: ["humanX", "humanY", "humanZ"] as ParticipantRole[],
      required: true,
    },

    // The information card this participant was dealt.
    assignedProfile: {
      type: String,
      enum: ["X", "Y", "Z"] as ProfileSlot[],
      required: true,
    },

    // The participant's own choice before the discussion.
    preDiscussionChoice: {
      type: String,
      enum: ["A", "B", "C", "D"] as Candidate[],
    },

    // The participant's choice after the discussion.
    teamDecisionChoice: { type: String, enum: ["A", "B", "C", "D"] as Candidate[] },

    progress: { type: progressSchema, default: () => ({}) },
    gateArrivals: { type: gateDatesSchema, default: () => ({}) },

    lastSeenAt: Date,
    // Set when the participant finishes the last step.
    completedAt: Date,
  },
  { timestamps: true },
);

export const Participant = mongoose.model("Participant", participantSchema);
