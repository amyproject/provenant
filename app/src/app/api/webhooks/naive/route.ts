import { nudgeAutopilot } from "@/server/agent/autopilot";
import { badRequest } from "@/server/errors";
import { handle } from "@/server/http";
import { getNaive } from "@/server/naive";
import { queueInbound } from "@/server/services/inbound";

/** Inbound supplier replies from Naive. Queued on the case; the agent ingests them on its next step. */
export async function POST(req: Request) {
  return handle(req, async () => {
    let body: unknown;
    try {
      body = JSON.parse(await req.text());
    } catch {
      throw badRequest("webhook body is not valid JSON");
    }
    const message = await getNaive().parseWebhook(body, req.headers);
    if (!message) throw badRequest("unrecognised webhook payload");
    const queued = await queueInbound(message);
    nudgeAutopilot();
    return queued;
  }, 202, "webhook");
}
