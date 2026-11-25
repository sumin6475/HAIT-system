// Session and participant codes.
// Test sessions and study sessions use different prefixes:
//     test:  T-C1-001 / TP-X-C1-001
//     study: S-C1-001 / P-X-C1-001
// Each prefix counts on its own, so test sessions never use up study numbers.

import { Session } from "../models/Session.js";
import type { ConditionCode, ParticipantRole, ProfileSlot } from "../types.js";

const SEQ_PAD = 3;
const SEQ_MAX = 999;

const SESSION_PREFIX_TEST = "T";
const SESSION_PREFIX_REAL = "S";
const PARTICIPANT_PREFIX_TEST = "TP";
const PARTICIPANT_PREFIX_REAL = "P";

// The prefix, decided in one place.
function sessionPrefix(isTest: boolean): string {
  return isTest ? SESSION_PREFIX_TEST : SESSION_PREFIX_REAL;
}

function participantPrefix(isTest: boolean): string {
  return isTest ? PARTICIPANT_PREFIX_TEST : PARTICIPANT_PREFIX_REAL;
}

// The next number for a condition and prefix.
// Example: if T-C1-010 is the highest, this returns 011. S-C1 is counted separately.
export async function generateNextSeq(
  conditionCode: ConditionCode,
  isTest: boolean,
): Promise<string> {
  const prefix = sessionPrefix(isTest);

  // Find the highest session code with this prefix (an anchored regex uses the index).
  const pattern = new RegExp(`^${prefix}-${conditionCode}-\\d{${SEQ_PAD}}$`);
  const last = await Session.findOne({
    conditionCode,
    sessionCode: { $regex: pattern },
  })
    .sort({ sessionCode: -1 })
    .lean();

  if (!last) return "001";

  // Read the last three digits of the code.
  const lastSeqStr = last.sessionCode.slice(-SEQ_PAD);
  const lastSeq = parseInt(lastSeqStr, 10);

  if (isNaN(lastSeq)) {
    throw new Error(`Invalid sessionCode format: ${last.sessionCode}`);
  }

  if (lastSeq >= SEQ_MAX) {
    throw new Error(
      `seq exhausted for ${prefix}-${conditionCode}: ${lastSeq} >= ${SEQ_MAX}. Switch to longer format.`,
    );
  }

  return String(lastSeq + 1).padStart(SEQ_PAD, "0");
}

// Session code, for example T-C1-001 or S-C1-001.
export function buildSessionCode(
  conditionCode: ConditionCode,
  seq: string,
  isTest: boolean,
): string {
  return `${sessionPrefix(isTest)}-${conditionCode}-${seq}`;
}

// Participant code, for example TP-X-C1-001 or P-X-C1-001.
export function buildParticipantCode(
  role: ParticipantRole,
  conditionCode: ConditionCode,
  seq: string,
  isTest: boolean,
): string {
  const slot: ProfileSlot = role.slice(5) as ProfileSlot; //humanX -> X
  return `${participantPrefix(isTest)}-${slot}-${conditionCode}-${seq}`;
}

// Who takes part in each condition: CTRL has three humans (X, Y, Z); the others have two (X, Y).
export function getParticipantSlots(
  conditionCode: ConditionCode,
): Array<{ role: ParticipantRole; profile: ProfileSlot }> {
  if (conditionCode === "CTRL") {
    return [
      { role: "humanX", profile: "X" },
      { role: "humanY", profile: "Y" },
      { role: "humanZ", profile: "Z" },
    ];
  }
  return [
    { role: "humanX", profile: "X" },
    { role: "humanY", profile: "Y" },
  ];
}
