import type { CreatePassportResponse } from "@/contracts";
import { handle, readJson } from "@/server/http";
import { createPassport } from "@/server/services/passports";
import { CreatePassportSchema } from "@/server/validation";

/** Create + sign a part passport with the supplier's Ed25519 key (new version if prevVersionId is set). */
export async function POST(req: Request) {
  return handle(req, async (): Promise<CreatePassportResponse> => createPassport(await readJson(req, CreatePassportSchema)), 201);
}
