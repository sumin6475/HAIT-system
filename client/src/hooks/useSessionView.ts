// The session list tab (All / Main / Test), shared by the Sessions and Chat Logs pages.
// Kept in the address (?view=) so it survives reloads and the back button. See @/lib/sessionView for the rules.

import { useSearchParams } from "react-router-dom";
import { parseSessionView, type SessionView } from "@/lib/sessionView";

export function useSessionView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseSessionView(searchParams.get("view"));
  const setView = (next: SessionView) =>
    setSearchParams(next === "all" ? {} : { view: next }, { replace: true });
  return [view, setView] as const;
}
