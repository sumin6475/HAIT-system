/**
 * Checks that can be switched off for a comparison run.
 *
 * Each flag turns off something that changes what a turn may be: four of them are
 * checks that can cost Alex a turn, and the last two decide what a turn is for.
 * They let a session be run twice, once with a check on and once with it off, so
 * the two transcripts can be compared.
 *
 * Two rules keep this safe.
 *
 * Every flag defaults to ON. An unset variable, a typo, or a missing `.env` all
 * give the normal behaviour, so a comparison run has to be asked for and can
 * never happen by accident.
 *
 * The server prints which checks are off when it starts (`guardFlagsSummary`).
 */

export type GuardFlagName =
  /** The post-generation scope check. Off: a message that names a fact outside the Judge's list is broadcast anyway. */
  | "outputScope"
  /** The ordinary cooldown veto. Off: Alex may take consecutive turns. */
  | "cooldown"
  /** The human-floor veto. Off: Alex may speak while a human still holds the floor. */
  | "humanFloor"
  /** Rejecting a Judge decision because its brief is missing or too long. Off: the decision stands and the brief is used as-is. */
  | "judgeBrief"
  /** Refusing to open a request addressed to Alex from an implicit proposal. Off: an ordinary opinion opens one, as before. */
  | "implicitRequest"
  /** Reading the Observer's own scope fields to authorise the exact board recap. Off: the word list has to agree, as before. */
  | "observerBoardRecap";

const ENV_KEY: Record<GuardFlagName, string> = {
  outputScope: "HAIT_GUARD_OUTPUT_SCOPE",
  cooldown: "HAIT_GUARD_COOLDOWN",
  humanFloor: "HAIT_GUARD_HUMAN_FLOOR",
  judgeBrief: "HAIT_GUARD_JUDGE_BRIEF",
  implicitRequest: "HAIT_GUARD_IMPLICIT_REQUEST",
  observerBoardRecap: "HAIT_GUARD_OBSERVER_BOARD_RECAP",
};

const ALL: GuardFlagName[] = [
  "outputScope",
  "cooldown",
  "humanFloor",
  "judgeBrief",
  "implicitRequest",
  "observerBoardRecap",
];

// "off", "0", "false", "no" all disable. Anything else — including an unset
// variable — leaves the guard on.
function readFlag(name: GuardFlagName): boolean {
  const raw = process.env[ENV_KEY[name]]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return true;
  return !(raw === "off" || raw === "0" || raw === "false" || raw === "no");
}

export function guardEnabled(name: GuardFlagName): boolean {
  return readFlag(name);
}

/**
 * Put every guard back on, ignoring `.env`.
 *
 * The offline suites load `server/.env` through dotenvx, so the moment a
 * comparison run left `HAIT_GUARD_HUMAN_FLOOR=off` in that file, the ledger
 * suite started asserting the behaviour of a build nobody ships — and it did not
 * say so, it simply failed on a floor assertion with a message about floors. The
 * inverse is worse: a suite that passes only because a check was disabled reads
 * exactly like a suite that passes.
 *
 * Every test entry point calls this first. A test that wants a guard off sets it
 * afterwards, deliberately and in one visible place.
 */
export function forceGuardsOnForTest(): void {
  for (const key of Object.values(ENV_KEY)) delete process.env[key];
}

/** The guards currently switched off, for the session and intervention records. Empty on a normal run. */
export function disabledGuards(): GuardFlagName[] {
  return ALL.filter((name) => !readFlag(name));
}

/** A one-line description for the startup log, so a comparison build announces itself. */
export function guardFlagsSummary(): string | null {
  const off = disabledGuards();
  return off.length
    ? `COMPARISON BUILD — guards disabled: ${off.map((name) => `${name} (${ENV_KEY[name]})`).join(", ")}`
    : null;
}
