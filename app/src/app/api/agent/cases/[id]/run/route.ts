import type { AgentStepResponse } from "@/contracts";
import { run } from "@/server/agent/machine";
import { handle } from "@/server/http";

/** Advance until the case rests (awaiting_supplier, monitoring, closed or escalated). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async (): Promise<AgentStepResponse> => run((await params).id));
}
