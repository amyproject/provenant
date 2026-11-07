// StubNaive: default adapter. Records outbound messages locally and simulates supplier replies
// (with real PDF attachments) from data/seed/replies.json, so the whole loop completes offline.
import { z } from "zod";
import type { NaiveInboundMessage, NaivePort, NaiveSendRequest, OutboundMessage } from "@/contracts";
import repliesJson from "../../../data/seed/replies.json";
import type { Repo } from "../repo";
import { DEMO_META_ID } from "../seed/constants";
import { seedDocument } from "../seed/documents";
import { newId, nowIso } from "../util/ids";

interface FixtureReply {
  afterAttempt: number;
  from: string;
  body: string;
  /** Document ids (documents.json) or a supplier-signed passport credential. */
  attachments: (string | { passport: string })[];
}

const REPLIES = repliesJson.replies as unknown as Record<string, FixtureReply[]>;

export const InboundMessageSchema = z.object({
  providerMessageId: z.string().min(1),
  caseId: z.string().min(1).optional(),
  from: z.string().min(1),
  subject: z.string(),
  body: z.string(),
  attachments: z
    .array(z.object({ filename: z.string().min(1), contentType: z.string().min(1), base64: z.string() }))
    .default([]),
  receivedAt: z.string().default(() => nowIso()),
});

export const stubReplyId = (caseId: string, index: number) => `stub-reply-${caseId}-${index}`;

export class StubNaive implements NaivePort {
  readonly mode = "stub" as const;

  constructor(private readonly repo: () => Repo) {}

  async sendMessage(req: NaiveSendRequest): Promise<OutboundMessage> {
    return {
      id: newId("msg"),
      caseId: req.caseId,
      channel: "email",
      to: req.to,
      subject: req.subject,
      body: req.body,
      provider: "stub",
      providerMessageId: newId("stub-out"),
      sentAt: nowIso(),
    };
  }

  /** Replies due once the agent has sent `afterAttempt` messages on the case and not yet delivered. */
  async fetchInbound(caseId: string): Promise<NaiveInboundMessage[]> {
    const repo = this.repo();
    const agentCase = await repo.cases.get(caseId);
    if (!agentCase) return [];
    const replies = REPLIES[agentCase.supplierId] ?? [];
    if (!replies.length) return [];
    const sent = await repo.outbox.list({ caseId });
    const lastSubject = sent.at(-1)?.subject ?? "Evidence request";
    const due: NaiveInboundMessage[] = [];
    for (const [i, r] of replies.entries()) {
      const id = stubReplyId(caseId, i);
      if (sent.length < r.afterAttempt || (await repo.inbox.get(id))) continue;
      due.push({
        providerMessageId: id,
        caseId,
        from: r.from,
        subject: `Re: ${lastSubject}`,
        body: r.body,
        attachments: await Promise.all(r.attachments.map((a) => this.attachment(a))),
        receivedAt: nowIso(),
      });
    }
    return due;
  }

  private async attachment(a: string | { passport: string }): Promise<NaiveInboundMessage["attachments"][number]> {
    if (typeof a === "string") {
      const d = seedDocument(a);
      return { filename: d.filename, contentType: "application/pdf", base64: d.bytes.toString("base64") };
    }
    // The supplier's system signed this passport at manufacture; it travels as a vc+jwt attachment.
    const repo = this.repo();
    const p = (await repo.meta.get(DEMO_META_ID))?.pendingPassports?.[a.passport] ?? (await repo.passports.get(a.passport));
    if (!p) throw new Error(`stub reply references unknown passport ${a.passport}`);
    return {
      filename: `${p.serialOrBatch}_passport_v${p.version}.jwt`,
      contentType: "application/vc+jwt",
      base64: Buffer.from(p.jwt).toString("base64"),
    };
  }

  /** Accepts a NaiveInboundMessage-shaped JSON body (lets the UI/QA inject a manual supplier reply). */
  async parseWebhook(body: unknown): Promise<NaiveInboundMessage | null> {
    const parsed = InboundMessageSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  }
}
