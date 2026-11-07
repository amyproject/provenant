import { handle } from "@/server/http";
import { resetDemo } from "@/server/seed";

/** Reseed suppliers A/B/C, policy, passports and documents (also restores a tampered passport). */
export async function POST(req: Request) {
  return handle(req, async () => {
    await resetDemo();
    return { ok: true as const };
  });
}
