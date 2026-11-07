import type { NaiveInboundMessage } from "@/contracts";
import { appendEvent, FINAL_STATES } from "../agent/machine";
import { senderAddress, senderMatchesSupplier } from "../agent/senders";
import { badRequest, notFound } from "../errors";
import { getRepo } from "../repo";
import { nowIso } from "../util/ids";

/** Webhook message ids are namespaced so a caller can never collide with (or pre-empt) stub reply ids. */
export const webhookInboxId = (providerMessageId: string) => `naive-wh:${providerMessageId}`;

export interface QueueResult {
  ok: true;
  caseId: string;
  duplicate: boolean;
  /** True when the sender is not the case supplier: nothing was queued. */
  ignored: boolean;
}

/**
 * Queue a supplier reply (from a Naive webhook) on its case. Uses message.caseId when present,
 * otherwise the newest open case whose supplier contact matches the sender. Replies from anyone
 * other than the case supplier are ignored and logged as a system event; they never change the case.
 */
export async function queueInbound(message: NaiveInboundMessage): Promise<QueueResult> {
  const repo = getRepo();
  let caseId = message.caseId;
  if (!caseId) {
    const sender = senderAddress(message.from);
    const suppliers = (await repo.suppliers.list()).filter((s) => s.contactEmail.toLowerCase() === sender);
    const open = (await repo.cases.list())
      .filter((c) => suppliers.some((s) => s.id === c.supplierId) && !FINAL_STATES.includes(c.state))
      .at(-1);
    if (!open) throw badRequest(`no open case for sender ${message.from}`);
    caseId = open.id;
  }
  const agentCase = await repo.cases.get(caseId);
  if (!agentCase) throw notFound("agent case", caseId);
  const supplier = await repo.suppliers.get(agentCase.supplierId);
  if (!supplier) throw notFound("supplier", agentCase.supplierId);

  if (!senderMatchesSupplier(message.from, supplier)) {
    // Ignored and logged only: an unknown sender must never be able to change a case (no escalation,
    // no attempt counting), otherwise anyone could force cases out of the pipeline.
    const repeat = (await repo.events.list({ caseId })).some((e) => e.detail?.ignoredSender);
    await appendEvent({
      caseId,
      at: nowIso(),
      state: agentCase.state,
      actor: "system",
      summary:
        `Reply from unknown sender ${senderAddress(message.from)} ignored: evidence for this case is only accepted from ${supplier.contactEmail}.` +
        (repeat ? " Repeated unknown-sender replies on this case; possible spoofing attempt." : ""),
      detail: { ignoredSender: senderAddress(message.from), attachments: message.attachments.map((a) => a.filename), repeat },
    });
    return { ok: true, caseId, duplicate: false, ignored: true };
  }

  const id = webhookInboxId(message.providerMessageId);
  if (await repo.inbox.get(id)) return { ok: true, caseId, duplicate: true, ignored: false };
  await repo.inbox.put({ id, caseId, message: { ...message, caseId }, processed: false, receivedAt: message.receivedAt });
  await appendEvent({
    caseId,
    at: message.receivedAt,
    state: agentCase.state,
    actor: "supplier",
    summary: `Reply from ${message.from}: "${message.subject}" with ${message.attachments.length} attachment(s) (via webhook).`,
    detail: { providerMessageId: message.providerMessageId, body: message.body, attachments: message.attachments.map((a) => a.filename) },
  });
  return { ok: true, caseId, duplicate: false, ignored: false };
}
