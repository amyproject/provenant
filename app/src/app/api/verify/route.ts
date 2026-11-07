import type { VerifyResponse } from "@/contracts";
import { verifyPassportJwt } from "@/server/crypto/vc";
import { handle, readJson } from "@/server/http";
import { getRepo } from "@/server/repo";
import { VerifySchema } from "@/server/validation";

/** Public verification of a passport JWT (used by the QR page /verify/[passportId]). */
export async function POST(req: Request) {
  return handle(req, async (): Promise<VerifyResponse> => {
    const { jwt } = await readJson(req, VerifySchema);
    return verifyPassportJwt(jwt, getRepo());
  }, 200, "public");
}
