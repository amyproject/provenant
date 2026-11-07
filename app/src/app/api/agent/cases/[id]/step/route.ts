import type { AgentStepResponse } from "@/contracts";
import { step } from "@/server/agent/machine";
import { handle } from "@/server/http";

/** Advance exactly one state. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async (): Promise<AgentStepResponse> => step((await params).id));
}
