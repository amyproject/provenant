import type { TamperResponse } from "@/contracts";
import { handle, readJson } from "@/server/http";
import { tamperPassport } from "@/server/services/demo";
import { TamperSchema } from "@/server/validation";

/** Edit one claim of a passport JWT without re-signing and persist it (demo only; restore/reset undo it). */
export async function POST(req: Request) {
  return handle(req, async (): Promise<TamperResponse> => {
    return tamperPassport(await readJson(req, TamperSchema));
  });
}
