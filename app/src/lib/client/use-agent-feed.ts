"use client";

import type { AgentEvent } from "@/contracts";
import { api, ApiClientError } from "./api";
import { useApi } from "./hooks";

/**
 * Newest-first event stream across all cases from GET /api/agent/events. If that route is missing
 * (404 on an older backend), falls back to fanning out GET /api/agent/cases/:id/events per case.
 */
export function useAgentFeed(pollMs = 2500, limit = 200) {
  return useApi<AgentEvent[]>(
    `feed:${limit}`,
    async () => {
      let events: AgentEvent[];
      try {
        events = await api.listEvents(undefined, limit);
      } catch (e) {
        if (!(e instanceof ApiClientError && e.status === 404)) throw e;
        const cases = await api.listCases();
        const lists = await Promise.all(cases.map((c) => api.caseEvents(c.id).catch(() => [] as AgentEvent[])));
        events = lists
          .flat()
          .sort((a, b) => a.at.localeCompare(b.at))
          .slice(-limit);
      }
      return [...events].reverse();
    },
    pollMs,
  );
}
