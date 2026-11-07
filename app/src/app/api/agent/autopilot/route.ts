import type { AutopilotStatus } from "@/contracts";
import { autopilotStatus, setAutopilot } from "@/server/agent/autopilot";
import { handle, readJson } from "@/server/http";
import { AutopilotSchema } from "@/server/validation";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async (): Promise<AutopilotStatus> => autopilotStatus());
}

export async function POST(req: Request) {
  return handle(req, async (): Promise<AutopilotStatus> => setAutopilot((await readJson(req, AutopilotSchema)).enabled));
}
