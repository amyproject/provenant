import type { PartPassport } from "@/contracts";
import { handle, readJson } from "@/server/http";
import { restorePassport } from "@/server/services/demo";
import { RestorePassportSchema } from "@/server/validation";

/** Put back ONE passport's original signed JWT after a tamper (unlike /demo/reset, keeps POs and cases). */
export async function POST(req: Request) {
  return handle(req, async (): Promise<PartPassport> => {
    return restorePassport((await readJson(req, RestorePassportSchema)).passportId);
  });
}
