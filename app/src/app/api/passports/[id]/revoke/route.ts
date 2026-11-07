import type { PartPassport } from "@/contracts";
import { handle } from "@/server/http";
import { revokePassport } from "@/server/services/passports";

/** Revoke via the Bitstring Status List; verification then fails with reason "revoked". */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async (): Promise<PartPassport> => revokePassport((await params).id));
}
