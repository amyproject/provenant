// NaivePort factory: live adapter when NAIVE_API_KEY is set AND the live mapping exists; otherwise the
// stub (integration status reports "live_pending" when a key is set but the adapter is still a TODO).
import type { NaivePort } from "@/contracts";
import { env } from "../env";
import { getRepo } from "../repo";
import { LIVE_NAIVE_IMPLEMENTED, LiveNaive } from "./live";
import { StubNaive } from "./stub";

export { StubNaive, InboundMessageSchema, stubReplyId } from "./stub";
export { LiveNaive, NaiveNotImplementedError, LIVE_NAIVE_IMPLEMENTED } from "./live";

export function getNaive(): NaivePort {
  return env.naiveLive() && LIVE_NAIVE_IMPLEMENTED ? new LiveNaive(process.env.NAIVE_API_KEY!) : new StubNaive(getRepo);
}
