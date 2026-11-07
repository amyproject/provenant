import type { TamperResponse } from "@/contracts";
import { handle, readJson } from "@/server/http";
import { tamperPassport } from "@/server/services/demo";
import { TamperSchema } from "@/server/validation";

/** Serverless: give the after() continuation (agent driving ~20 s) room to finish. */
export const maxDuration = 60;

/** Edit one claim of a passport JWT without re-signing and persist it (demo only; restore/reset undo it). */
export async function POST(req: Request) {
  return handle(req, async (): Promise<TamperResponse> => {
    return tamperPassport(await readJson(req, TamperSchema));
  });
}
