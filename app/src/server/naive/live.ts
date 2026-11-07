// LiveNaive: used when NAIVE_API_KEY is set. Naive (https://usenaive.ai/docs) is the hackathon's
// required platform, but its API shape was not available when this was written.
//
// TODO(naive): map the three NaivePort calls onto the real Naive API:
//   1. sendMessage   -> Naive "send email / run outreach action" endpoint. Must return the provider
//                       message id so replies can be threaded back to the AgentCase (put caseId in
//                       metadata or a reply-to alias like case+<caseId>@...).
//   2. fetchInbound  -> Naive inbox poll (or return [] and rely on webhooks buffered in the inbox
//                       collection by /api/webhooks/naive — the agent reads both).
//   3. parseWebhook  -> verify Naive's webhook signature header, then map the payload (sender,
//                       subject, body, attachments as base64) to NaiveInboundMessage.
// Until then every call throws a descriptive error; the agent catches it and escalates the case
// instead of silently pretending a message was sent.
import type { NaiveInboundMessage, NaivePort, NaiveSendRequest, OutboundMessage } from "@/contracts";

/** Flip to true once the three calls below are mapped onto the real Naive API. Until then the stub runs. */
export const LIVE_NAIVE_IMPLEMENTED = false;

export class NaiveNotImplementedError extends Error {
  constructor(call: string) {
    super(
      `LiveNaive.${call} is not implemented: NAIVE_API_KEY is set but the Naive API mapping is still a TODO ` +
        `(src/server/naive/live.ts). Unset NAIVE_API_KEY to use the stub adapter.`,
    );
    this.name = "NaiveNotImplementedError";
  }
}

export class LiveNaive implements NaivePort {
  readonly mode = "live" as const;

  // Kept for the real implementation (Authorization header).
  constructor(private readonly apiKey: string) {}

  async sendMessage(req: NaiveSendRequest): Promise<OutboundMessage> {
    void req;
    void this.apiKey;
    throw new NaiveNotImplementedError("sendMessage");
  }

  async fetchInbound(caseId: string): Promise<NaiveInboundMessage[]> {
    void caseId;
    throw new NaiveNotImplementedError("fetchInbound");
  }

  async parseWebhook(body: unknown, headers: Headers): Promise<NaiveInboundMessage | null> {
    void body;
    void headers;
    throw new NaiveNotImplementedError("parseWebhook");
  }
}
