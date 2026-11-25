// React Query hook for conditions, used by the dashboard's Conditions page.
//   useConditions()  every condition's prompts

import { useQuery } from "@tanstack/react-query";
import { getConditions } from "@/lib/api";

const CONDITIONS_KEY = ["conditions"] as const;

// Every condition's prompts. They never change while the server runs, so there is no refetch.
export function useConditions() {
  return useQuery({
    queryKey: CONDITIONS_KEY,
    queryFn: getConditions,
    staleTime: Infinity, // keep the cache forever
    refetchOnWindowFocus: false, // no refresh on window focus
  });
}
