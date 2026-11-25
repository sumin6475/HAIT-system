// Timing and pacing settings for Alex.
export const TRIGGER_CONFIG = {
  // Long silence is a restrained backup route, not the primary speaking path.
  LONG_SILENCE_SECONDS: 60,
  LONG_SILENCE_MAX_BROADCASTS: 3,
  LONG_SILENCE_MIN_INTERVAL_MS: 5 * 60 * 1000,
  LONG_SILENCE_MIN_HUMAN_MSGS_SINCE_AI: 2,

  // Cooldown: after Alex speaks, it stays silent until this many human messages have arrived (being named directly is the exception).
  COOLDOWN_MIN_MSGS: 2,

  // Total discussion length. Must equal DISCUSSION_DURATION_MINUTES in the
  // client's sessionConfig.ts, or the timer on screen and the moment Alex closes
  // would disagree in front of participants. (The two packages are separate, so
  // one cannot import the other.)
  DISCUSSION_DURATION_MS: 30 * 60 * 1000,
  // A candidate counts as covered in depth once this many distinct traits about it are in view.
  DEPTH_MIN_PER_CAND: 3,
  // How many recent human messages to look back through to find the candidate under discussion.
  DEPTH_LOOKBACK_MSGS: 4,

  // Floor pauses. A pause only changes how soon Alex speaks, never whether two Alex
  // turns can follow each other: back-to-back Alex turns are impossible by design,
  // even if a pattern or a judge is wrong.
  ADDRESS_FLOOR_MS: 2_000,
  FOLLOWUP_FLOOR_MS: 2_000,
  MAIN_ROUTE_DELAY_MS: 3_000,
  BACKCHANNEL_GAP_MS: 15_000, // the shortest gap between two backchannels
  BACKCHANNEL_RATE: 1,

  MEDIATION_TTL_MS: 3 * 60 * 1000,
  MEDIATION_TTL_HUMAN_MESSAGES: 8,
  MEDIATION_BUILD_ON_THRESHOLD: 2,
} as const;
