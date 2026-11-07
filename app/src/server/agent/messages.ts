// The agent writes its own supplier emails: Claude in live mode, a solid template otherwise.
import type { EvidenceGap, PurchaseOrder, Supplier } from "@/contracts";
import { claudeText } from "../extract/claude";

export interface EvidenceRequestInput {
  supplier: Pick<Supplier, "legalName" | "contactEmail">;
  po: Pick<PurchaseOrder, "id" | "amountUsd" | "riskTier">;
  gaps: EvidenceGap[];
  attempt: number;
  maxAttempts: number;
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export function evidenceRequestSubject(i: EvidenceRequestInput): string {
  return i.attempt <= 1
    ? `Evidence request for PO ${i.po.id}: ${i.gaps.length} document${i.gaps.length === 1 ? "" : "s"} needed`
    : `Reminder ${i.attempt}/${i.maxAttempts}: evidence still needed for PO ${i.po.id}`;
}

export function templateEvidenceRequest(i: EvidenceRequestInput): { subject: string; body: string } {
  const list = i.gaps.map((g, n) => `  ${n + 1}. ${g.description}`).join("\n");
  const opener =
    i.attempt <= 1
      ? `We are reviewing purchase order ${i.po.id} (${usd(i.po.amountUsd)}, ${i.po.riskTier}-risk tier) and need the following before it can be released:`
      : `Following up on our earlier request for purchase order ${i.po.id}. We still need:`;
  const closer =
    i.attempt >= i.maxAttempts
      ? "This is our final request. After this, the order will be evaluated on the evidence on file and any missing items will count against it."
      : `Please reply to this email with the documents attached (PDF). This is request ${i.attempt} of ${i.maxAttempts}.`;
  return {
    subject: evidenceRequestSubject(i),
    body: `Hello ${i.supplier.legalName} team,\n\n${opener}\n\n${list}\n\n${closer}\n\nThank you,\nProvenant compliance agent (on behalf of the buyer)`,
  };
}

const SYSTEM = [
  "You are a procurement compliance agent writing to a supplier on behalf of a buyer.",
  "Write a short, courteous, specific email body (no subject line). List every requested item as a numbered list.",
  "State the attempt number; if it is the final attempt, say missing items will count against the order.",
  "Sign as 'Provenant compliance agent (on behalf of the buyer)'. Plain text only.",
].join(" ");

export async function composeEvidenceRequest(i: EvidenceRequestInput): Promise<{ subject: string; body: string; author: "claude" | "template" }> {
  const tpl = templateEvidenceRequest(i);
  const body = await claudeText(
    SYSTEM,
    JSON.stringify({
      supplier: i.supplier.legalName,
      purchaseOrder: i.po.id,
      amountUsd: i.po.amountUsd,
      riskTier: i.po.riskTier,
      requestedItems: i.gaps.map((g) => g.description),
      attempt: i.attempt,
      maxAttempts: i.maxAttempts,
    }),
    600,
  );
  return body ? { subject: tpl.subject, body, author: "claude" } : { ...tpl, author: "template" };
}
