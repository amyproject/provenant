// Port to the Naive platform (https://usenaive.ai/docs). OWNER: lead.
// The hackathon requires Naive. We do not have a token yet, so the backend ships two adapters:
//   - StubNaive  (default): records messages locally and simulates supplier replies from fixtures.
//   - LiveNaive  (NAIVE_API_KEY set): maps these calls onto the real Naive API.
// TODO(lead): refine this interface against the real Naive docs once fetched; keep call sites
// depending only on this port so swapping in the live adapter touches one directory.

import type { OutboundMessage } from "./domain";

export interface NaiveSendRequest {
  caseId: string;
  to: string;
  subject: string;
  body: string;
}

export interface NaiveInboundMessage {
  providerMessageId: string;
  caseId?: string;
  from: string;
  subject: string;
  body: string;
  attachments: { filename: string; contentType: string; base64: string }[];
  receivedAt: string;
}

export interface NaivePort {
  readonly mode: "stub" | "live";
  /** Send an evidence request / follow-up to a supplier. */
  sendMessage(req: NaiveSendRequest): Promise<OutboundMessage>;
  /** Pull replies not yet processed (stub: fixture replies; live: API poll or buffered webhooks). */
  fetchInbound(caseId: string): Promise<NaiveInboundMessage[]>;
  /** Parse a webhook body from Naive into an inbound message (live mode). */
  parseWebhook(body: unknown, headers: Headers): Promise<NaiveInboundMessage | null>;
}
