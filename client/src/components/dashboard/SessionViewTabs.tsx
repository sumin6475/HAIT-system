// Session list tabs (All / Main / Test), shared by the Sessions and Chat Logs pages.
// See @/lib/sessionView for the rules.

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SessionSummary } from "@/lib/api";
import {
  parseSessionView,
  SESSION_VIEWS,
  sessionsInView,
  type SessionView,
} from "@/lib/sessionView";

export function SessionViewTabs({
  view,
  onChange,
  sessions,
}: {
  view: SessionView;
  onChange: (next: SessionView) => void;
  // Hide the counts until the list has loaded.
  sessions?: SessionSummary[];
}) {
  return (
    <Tabs value={view} onValueChange={(v) => onChange(parseSessionView(v))}>
      <TabsList>
        {SESSION_VIEWS.map((v) => (
          <TabsTrigger key={v.value} value={v.value}>
            {v.label}
            {sessions && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {sessionsInView(sessions, v.value).length}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
