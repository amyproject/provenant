import type { AgentTickResponse } from "@/contracts";
import { kickCases } from "@/server/agent/autopilot";
import { tick } from "@/server/agent/machine";
import { handle } from "@/server/http";

/** Serverless: give the after() continuation (agent driving ~20 s) room to finish. */
export const maxDuration = 60;

/** Manual heartbeat: advance every open case one step now (the autopilot does the same for due cases). */
export async function POST(req: Request) {
  return handle(req, async (): Promise<AgentTickResponse> => {
    const advanced = await tick();
    await kickCases(advanced.map((r) => r.agentCase.id)); // request mode: keep driving after the response
    return { advanced };
  });
}
