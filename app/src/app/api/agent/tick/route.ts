import type { AgentTickResponse } from "@/contracts";
import { tick } from "@/server/agent/machine";
import { handle } from "@/server/http";

/** Manual heartbeat: advance every open case one step now (the autopilot does the same for due cases). */
export async function POST(req: Request) {
  return handle(req, async (): Promise<AgentTickResponse> => ({ advanced: await tick() }));
}
