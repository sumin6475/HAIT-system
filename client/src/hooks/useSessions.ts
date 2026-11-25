// React Query hooks for sessions, used by the dashboard's Sessions page.
//
//   useSessionList()       session list (refreshes on its own)
//   useSessionDetail(code) one session
//   useCreateSession()     create
//   useDeleteSession()     delete
//
// A successful change clears the list cache, so new data shows at once.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listSessions,
  getSession,
  createSession,
  deleteSession,
  approveGate,
  stopAI,
  type ConditionCode,
} from "@/lib/api";
import type { GateId } from "@/lib/gates";

const SESSIONS_KEY = ["sessions"] as const;

// Session list. Refreshes every 5 seconds to follow arrivals and status changes.
// Lower the interval if gate arrivals need to show sooner during a live session.
export function useSessionList() {
  return useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: listSessions,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
}

// One session with its participants.
export function useSessionDetail(sessionCode: string | undefined) {
  return useQuery({
    queryKey: [...SESSIONS_KEY, sessionCode],
    queryFn: () => getSession(sessionCode!),
    enabled: !!sessionCode,
    refetchInterval: (query) => (query.state.data?.session.status === "in_progress" ? 3000 : false),
  });
}

// Create a session.
export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { conditionCode: ConditionCode; isTest?: boolean }) => createSession(input),
    onSuccess: () => {
      // Clear the list cache so the new session shows at once.
      qc.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}

// Approve a gate.
export function useApproveGate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionCode, gate }: { sessionCode: string; gate: GateId }) =>
      approveGate(sessionCode, gate),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}

// Mute Alex (researcher stop switch), then refresh the list.
export function useStopAI() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionCode: string) => stopAI(sessionCode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}

// Delete a session.
export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionCode: string) => deleteSession(sessionCode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}
