import type { DemoRunResponse } from "@/contracts";
import { ApiProblem } from "@/server/errors";
import { handle } from "@/server/http";
import { runDemo } from "@/server/services/demo";

/** Serverless: give the after() continuation (agent driving ~20 s) room to finish. */
export const maxDuration = 60;

/**
 * Create the three demo POs and return immediately; the server autopilot drives them to decisions.
 * Idempotent: if the demo already ran since the last reset, 409 { error, results } with the existing run.
 */
export async function POST(req: Request) {
  return handle(req, async () => {
    try {
      return (await runDemo()) satisfies DemoRunResponse;
    } catch (err) {
      if (err instanceof ApiProblem && err.status === 409) {
        const { results } = err.details as DemoRunResponse;
        return Response.json({ error: err.message, results, details: { results } }, { status: 409 });
      }
      throw err;
    }
  });
}
