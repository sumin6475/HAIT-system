// The server closes the session at this same length: keep it equal to
// DISCUSSION_DURATION_MS in server/src/config/triggers.ts. The two packages are
// installed separately, so neither can import the other.
export const DISCUSSION_DURATION_MINUTES = 30;
export const MIN_DISCUSSION_MINUTES = 12;
