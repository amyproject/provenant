// The autonomous compliance agent. One AgentCase per purchase order, driven through AgentState on
// its own: step() advances exactly one state and appends human-readable AgentEvents; run() loops
// until the case rests (waiting on the supplier, monitoring, closed or escalated); tick() is the
// autopilot heartbeat that advances every open case. A human is only needed on escalation.
import type {
  AgentCase,
  AgentEvent,
  AgentState,
  AgentStepResponse,
  BuyerPolicy,
  EvidenceGap,
  NaiveInboundMessage,
  NaivePort,
  PurchaseOrder,
  Supplier,
} from "@/contracts";
import { getPlatformKey } from "../crypto/keys";
import { sha256OfJwt, signDecisionRecord, verifyPassportJwt } from "../crypto/vc";
import { env } from "../env";
import { notFound } from "../errors";
import { explainFlag, extractDocument, extractPdfText, isEvidenceKind } from "../extract";
import { evaluateFlags } from "../flags";
import { FLAG_TITLES, applyPolicy } from "../policy";
import { getNaive } from "../naive";
import { getRepo, RedisRepo, type Repo } from "../repo";
import { screenSupplier } from "../services/suppliers";
import { newId } from "../util/ids";
import { buildFlagContext, loadPassports } from "./context";
import { composeEvidenceRequest } from "./messages";
import { EVIDENCE_LABELS, computeGaps, extractIdentifiers, openGaps } from "./requirements";
import { senderAddress, senderMatchesSupplier } from "./senders";

export interface AgentOptions {
  /** Clock override (tests / demo). */
  now?: () => Date;
  /** Override the policy's re-chase interval (seconds). */
  rechaseSeconds?: number;
  /** Override the policy's maximum chase attempts. */
  maxAttempts?: number;
  naive?: NaivePort;
  /** Skip (no-op) unless the case's nextRunAt is due. Used by the autopilot so pacing holds. */
  onlyIfDue?: boolean;
}

/** States where run() stops: nothing more to do until time passes or something external happens. */
export const RESTING_STATES: AgentState[] = ["awaiting_supplier", "monitoring", "closed", "escalated"];
/** States tick() no longer advances. */
export const FINAL_STATES: AgentState[] = ["closed", "escalated"];

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

interface StepCtx {
  repo: Repo;
  naive: NaivePort;
  now: string;
  nowMs: number;
  rechaseSeconds: number;
  maxAttempts: number;
  c: AgentCase;
  po: PurchaseOrder;
  supplier: Supplier;
  policy: BuyerPolicy;
  events: AgentEvent[];
  emit(summary: string, detail?: Record<string, unknown>, actor?: AgentEvent["actor"]): void;
  go(state: AgentState): void;
}

// ---------- per-case serialization (tick, run and the UI may hit the same case concurrently) ----------

const g = globalThis as unknown as { __provenantLocks?: Map<string, Promise<unknown>> };
function withLock<T>(caseId: string, fn: () => Promise<T>): Promise<T> {
  g.__provenantLocks ??= new Map();
  const locks = g.__provenantLocks;
  const prev = locks.get(caseId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(caseId, next);
  void next.finally(() => {
    if (locks.get(caseId) === next) locks.delete(caseId);
  }).catch(() => undefined);
  return next;
}

// ---------- state handlers ----------

async function intake(x: StepCtx) {
  const passports = await loadPassports(x.repo, x.po.passportIds);
  const flagCount = x.policy.tierFlags[x.po.riskTier].length;
  const required = x.policy.tierRequiredEvidence[x.po.riskTier] ?? [];
  const evidence = required.map((k) => EVIDENCE_LABELS[k]);
  x.emit(
    `Picked up PO ${x.po.id}: ${x.supplier.legalName}, ${usd(x.po.amountUsd)}, ${x.po.riskTier} risk tier, ${plural(passports.length, "signed passport")}. ` +
      `Policy requires ${flagCount} red-flag checks${evidence.length ? ` and ${evidence.length} evidence items (${evidence.join(", ")})` : ""}.`,
    { riskTier: x.po.riskTier, passportIds: x.po.passportIds, requiredEvidence: required, flagCount },
  );
  x.go("screening");
}

async function screening(x: StepCtx) {
  const checks = await screenSupplier(x.repo, x.supplier, x.now);
  const issues = checks.filter((c) => c.status === "flag" || c.status === "error");
  const label = (k: string) => k.replace(/_/g, " ");
  x.emit(
    issues.length
      ? `Screened ${x.supplier.legalName} across ${checks.length} identity sources: ${plural(issues.length, "issue")} (${issues.map((c) => label(c.kind)).join(", ")}).`
      : `Screened ${x.supplier.legalName} across ${checks.length} identity sources (SAM.gov, sanctions lists, USPS address, domain age, name match, shipping records): no issues.`,
    { checks: checks.map((c) => ({ kind: c.kind, status: c.status, source: c.source })) },
  );
  x.go("gap_analysis");
}

async function gapAnalysis(x: StepCtx) {
  const documents = await x.repo.documents.list({ supplierId: x.supplier.id });
  x.c.gaps = computeGaps({ required: requiredEvidence(x), supplier: x.supplier, documents, existing: x.c.gaps, now: x.now });
  const open = openGaps(x.c.gaps);
  if (!open.length) {
    x.emit(
      x.c.gaps.length
        ? `All ${plural(x.c.gaps.length, "required evidence item")} on file. Moving to evaluation.`
        : `No additional evidence required for the ${x.po.riskTier} tier. Moving to evaluation.`,
      { gaps: x.c.gaps },
    );
    return x.go("evaluating");
  }
  const exhausted = open.some((gap) => gap.attempts >= x.maxAttempts);
  if (exhausted) return giveUpOnGaps(x, open);
  x.emit(`Missing ${plural(open.length, "evidence item")}: ${open.map((gap) => gap.description.toLowerCase()).join("; ")}. Requesting from supplier.`, { open });
  x.go("requesting");
}

const requiredEvidence = (x: StepCtx) => x.policy.tierRequiredEvidence[x.po.riskTier] ?? [];

function escalate(x: StepCtx, reason: string, detail?: Record<string, unknown>) {
  x.c.escalationReason = reason;
  x.emit(`${reason} Escalating to a human buyer.`, detail);
  x.go("escalated");
}

async function hasSupplierReplied(x: StepCtx) {
  return (await x.repo.inbox.list({ caseId: x.c.id })).some((m) => !m.ignored);
}

async function giveUpOnGaps(x: StepCtx, open: EvidenceGap[]) {
  if (await hasSupplierReplied(x)) {
    x.emit(
      `Supplier did not provide ${open.map((gap) => gap.description.toLowerCase()).join("; ")} after ${plural(x.maxAttempts, "request")}. ` +
        `Proceeding on the evidence on file; the missing items will count against the order.`,
      { unresolved: open },
    );
    return x.go("evaluating");
  }
  escalate(x, `Supplier unresponsive after ${plural(x.maxAttempts, "request")}.`, { unresolved: open });
}

async function requesting(x: StepCtx) {
  const open = openGaps(x.c.gaps);
  if (!open.length) return x.go("gap_analysis");
  const attempt = Math.max(...open.map((gap) => gap.attempts)) + 1;
  const email = await composeEvidenceRequest({ supplier: x.supplier, po: x.po, gaps: open, attempt, maxAttempts: x.maxAttempts });
  try {
    const msg = await x.naive.sendMessage({ caseId: x.c.id, to: x.supplier.contactEmail, subject: email.subject, body: email.body });
    await x.repo.outbox.put(msg);
    x.c.gaps = x.c.gaps.map((gap) => (gap.resolvedAt ? gap : { ...gap, attempts: gap.attempts + 1, requestedAt: x.now }));
    x.emit(
      `${attempt === 1 ? "Emailed" : `Re-chased (attempt ${attempt}/${x.maxAttempts})`} ${x.supplier.contactEmail} via ${x.naive.mode === "live" ? "Naive" : "Naive (stub)"}: "${email.subject}".`,
      { outboundMessageId: msg.id, provider: msg.provider, author: email.author, requested: open.map((gap) => gap.kind), attempt },
    );
    x.go("awaiting_supplier");
  } catch (err) {
    escalate(x, `Could not send the evidence request: ${err instanceof Error ? err.message : String(err)}.`, { error: String(err) });
  }
}

async function awaitingSupplier(x: StepCtx) {
  try {
    for (const m of await x.naive.fetchInbound(x.c.id)) {
      if (await x.repo.inbox.get(m.providerMessageId)) continue;
      if (!senderMatchesSupplier(m.from, x.supplier)) {
        await x.repo.inbox.put({ id: m.providerMessageId, caseId: x.c.id, message: m, processed: true, ignored: true, receivedAt: m.receivedAt });
        x.emit(`Reply from unknown sender ${senderAddress(m.from)} ignored: evidence is only accepted from ${x.supplier.contactEmail}.`, { ignoredSender: senderAddress(m.from) }, "system");
        continue;
      }
      await x.repo.inbox.put({ id: m.providerMessageId, caseId: x.c.id, message: m, processed: false, receivedAt: m.receivedAt });
      x.emit(`Reply from ${m.from}: "${m.subject}" with ${plural(m.attachments.length, "attachment")}.`, { providerMessageId: m.providerMessageId, body: m.body, attachments: m.attachments.map((a) => a.filename) }, "supplier");
    }
  } catch (err) {
    return escalate(x, `Could not check the supplier inbox: ${err instanceof Error ? err.message : String(err)}.`, { error: String(err) });
  }
  const pending = await x.repo.inbox.list({ caseId: x.c.id, processed: false });
  if (pending.length) {
    x.emit(`Ingesting ${plural(pending.reduce((n, p) => n + p.message.attachments.length, 0), "attachment")} from the supplier.`);
    return x.go("ingesting");
  }
  // Evidence may also arrive by manual upload while we wait.
  const documents = await x.repo.documents.list({ supplierId: x.supplier.id });
  if (!openGaps(computeGaps({ required: requiredEvidence(x), supplier: x.supplier, documents, existing: x.c.gaps, now: x.now })).length) {
    x.emit("Required evidence is now on file (uploaded directly). Re-running gap analysis.");
    return x.go("gap_analysis");
  }
  const open = openGaps(x.c.gaps);
  const lastRequest = Math.max(0, ...open.map((gap) => (gap.requestedAt ? Date.parse(gap.requestedAt) : 0)));
  const waitedSec = Math.floor((x.nowMs - lastRequest) / 1000);
  if (waitedSec < x.rechaseSeconds) return; // keep waiting; nothing to report
  if (open.some((gap) => gap.attempts >= x.maxAttempts)) return giveUpOnGaps(x, open);
  x.emit(`No reply after ${waitedSec}s. Scheduling a follow-up (attempt ${Math.max(...open.map((gap) => gap.attempts)) + 1}/${x.maxAttempts}).`);
  x.go("requesting");
}

async function ingesting(x: StepCtx) {
  const pending = await x.repo.inbox.list({ caseId: x.c.id, processed: false });
  let identityUpdated = false;
  for (const item of pending) {
    const texts = [item.message.body];
    for (const att of item.message.attachments) {
      if (!isPassportAttachment(att)) texts.push(extractPdfText(Buffer.from(att.base64, "base64")).join("\n"));
      if (isPassportAttachment(att)) {
        await ingestPassport(x, att);
        continue;
      }
      const out = await extractDocument({ kind: "other", filename: att.filename, contentType: att.contentType, base64: att.base64 });
      const kind = isEvidenceKind(out.extracted.documentType) ? out.extracted.documentType : "other";
      const doc = await x.repo.documents.put({
        id: newId("doc"),
        supplierId: x.supplier.id,
        kind,
        filename: att.filename,
        sha256: out.sha256,
        extracted: out.extracted,
        metadata: { ...out.metadata, extractedBy: out.source, providerMessageId: item.id },
        receivedVia: "naive_inbox",
        receivedAt: x.now,
      });
      const cert = out.extracted.certNumber ? ` #${out.extracted.certNumber}` : "";
      x.emit(
        `Extracted ${att.filename} -> ${EVIDENCE_LABELS[kind]}${cert} (${out.source === "claude" ? "Claude" : out.source}). ${String(out.extracted.summary ?? "")}`.trim(),
        { documentId: doc.id, kind, sha256: doc.sha256, extracted: out.extracted, extractedBy: out.source },
      );
    }
    // Bytes are now stored as documents; keep only filenames so the store stays small.
    const attachments = item.message.attachments.map((a) => ({ ...a, base64: "" }));
    await x.repo.inbox.put({ ...item, processed: true, message: { ...item.message, attachments } });
    // Company identifiers supplied in the reply resolve an identity_field gap.
    if (!x.supplier.uei || !x.supplier.ein) {
      const ids = extractIdentifiers(texts.join("\n"));
      const added = { ...(ids.uei && !x.supplier.uei ? { uei: ids.uei } : {}), ...(ids.ein && !x.supplier.ein ? { ein: ids.ein } : {}) };
      if (Object.keys(added).length) {
        x.supplier = await x.repo.suppliers.put({ ...x.supplier, ...added });
        identityUpdated = true;
        x.emit(`Recorded company identifiers from the supplier's reply: ${Object.entries(added).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(", ")}.`, added);
      }
    }
  }
  // New identifiers mean the identity checks (e.g. SAM.gov by UEI) must run again.
  x.go(identityUpdated ? "screening" : "gap_analysis");
}

type Attachment = NaiveInboundMessage["attachments"][number];

const isPassportAttachment = (a: Attachment) => a.contentType === "application/vc+jwt" || a.filename.toLowerCase().endsWith(".jwt");

/** A supplier-signed passport credential sent as an attachment: verify it, store it, and adopt it if it supersedes the PO's. */
async function ingestPassport(x: StepCtx, att: Attachment) {
  const jwt = Buffer.from(att.base64, "base64").toString("utf8").trim();
  const v = await verifyPassportJwt(jwt, x.repo);
  if (!v.valid || !v.passport) {
    x.emit(`Rejected ${att.filename}: the passport credential failed verification (${(v.reason ?? "invalid").replace(/_/g, " ")}).`, { reason: v.reason });
    return;
  }
  if (v.issuer?.supplierId !== x.supplier.id) {
    x.emit(`Rejected ${att.filename}: the passport was issued by ${v.issuer?.legalName ?? "another party"}, not ${x.supplier.legalName}.`);
    return;
  }
  const p = v.passport;
  if (!(await x.repo.passports.get(p.id))) await x.repo.passports.put({ ...p, jwt });
  const supersedes = p.prevVersionId && x.po.passportIds.includes(p.prevVersionId) ? p.prevVersionId : null;
  if (supersedes) {
    x.po = { ...x.po, passportIds: x.po.passportIds.map((id) => (id === supersedes ? p.id : id)) };
    await x.repo.purchaseOrders.put(x.po);
  }
  x.emit(
    `Verified supplier-signed passport v${p.version} (${p.id}, batch ${p.serialOrBatch}) against ${x.supplier.legalName}'s Ed25519 key.` +
      (supersedes ? ` It supersedes ${supersedes} on this PO; the order will be evaluated against the new version.` : ""),
    { passportId: p.id, version: p.version, supersedes, domesticContentRatio: p.domesticContentRatio },
  );
}

async function evaluating(x: StepCtx) {
  const ctx = await buildFlagContext(x.repo, x.po, x.now);
  const flagIds = ctx.policy.tierFlags[x.po.riskTier];
  const results = evaluateFlags(ctx, flagIds);
  for (const r of results) r.explanation = await explainFlag(r, x.supplier);
  await x.repo.flagResults.put({ id: x.po.id, purchaseOrderId: x.po.id, flags: results, evaluatedAt: x.now });
  const raised = results.filter((r) => r.status === "flag");
  x.emit(
    raised.length
      ? `Ran ${results.length} red-flag rules for the ${x.po.riskTier} tier: ${plural(raised.length, "flag")} raised (${raised.map((r) => `${r.flag.slice(0, 3)} ${FLAG_TITLES[r.flag].toLowerCase()}`).join("; ")}).`
      : `Ran ${results.length} red-flag rules for the ${x.po.riskTier} tier: all clear (${results.filter((r) => r.status === "pass").length} passed` +
          `${results.some((r) => r.status === "skip") ? `, ${results.filter((r) => r.status === "skip").length} skipped for lack of data` : ""}).`,
    { results: results.map((r) => ({ flag: r.flag, status: r.status, mode: r.mode })) },
  );
  x.go("deciding");
}

async function deciding(x: StepCtx) {
  const policy = x.policy;
  const flags = (await x.repo.flagResults.get(x.po.id))?.flags ?? [];
  const passports = await loadPassports(x.repo, x.po.passportIds);
  const identityChecks = (await x.repo.identityChecks.get(x.supplier.id))?.results ?? [];
  const result = applyPolicy({ policy, riskTier: x.po.riskTier, flags, passports, identityChecks, unresolvedGaps: openGaps(x.c.gaps) });
  x.c.decision = result.decision;
  x.po = { ...x.po, decisionReasons: result.reasons };
  await x.repo.purchaseOrders.put(x.po);
  x.emit(
    `Policy gate "${policy.name}": ${plural(result.issueCount, "issue")} against thresholds (quarantine at ${policy.quarantineAtFlagCount}, block at ${policy.blockAtFlagCount})` +
      `${result.hardStop ? `, hard stop: ${result.hardStop}` : ""} -> ${result.decision.toUpperCase()}.`,
    { decision: result.decision, issueCount: result.issueCount, countedFlags: result.countedFlags, domesticContent: result.domesticContent },
  );
  x.go("signing");
}

async function signing(x: StepCtx) {
  const policy = x.policy;
  const flags = (await x.repo.flagResults.get(x.po.id))?.flags ?? [];
  const passports = await loadPassports(x.repo, x.po.passportIds);
  const decidedPo = { ...x.po, decision: x.c.decision };
  const jwt = await signDecisionRecord({ po: decidedPo, policy, passports, flags, decidedAt: x.now });
  x.po = { ...x.po, decisionJwt: jwt };
  await x.repo.purchaseOrders.put(x.po);
  const key = await getPlatformKey();
  x.emit(`Signed the decision record (W3C VC, Ed25519, ${key.kid}). Record hash ${sha256OfJwt(jwt).slice(0, 16)}...`, { kid: key.kid, jwtSha256: sha256OfJwt(jwt) });
  x.go("enforcing");
}

async function enforcing(x: StepCtx) {
  x.po = { ...x.po, decision: x.c.decision };
  await x.repo.purchaseOrders.put(x.po);
  const msg: Record<string, string> = {
    approved: `PO ${x.po.id} APPROVED and released to procurement. Watching for passport changes (Loop 4).`,
    quarantined: `PO ${x.po.id} QUARANTINED: payment and receipt are held until the issue is remediated or a buyer overrides.`,
    blocked: `PO ${x.po.id} BLOCKED: the order cannot be released to ${x.supplier.legalName.replace(/\.$/, "")}.`,
  };
  // Name the forged/altered passport when that is why the order is held.
  const f01 = ((await x.repo.flagResults.get(x.po.id))?.flags ?? []).find((f) => f.flag === "F01_SIGNATURE_INVALID" && f.status === "flag");
  const failures = (f01?.evidence.failures ?? []) as { passportId: string; reason: string }[];
  if (f01 && failures.length && x.c.decision !== "approved") {
    const ids = failures.map((f) => f.passportId).join(", ");
    msg[x.c.decision] = `PO ${x.po.id} ${x.c.decision.toUpperCase()}: passport ${ids} signature no longer verifies (forged or altered). Payment and receipt are held.`;
  }
  x.emit(msg[x.c.decision] ?? `PO ${x.po.id} decision: ${x.c.decision}.`, { decision: x.c.decision });
  x.go(x.c.decision === "approved" ? "monitoring" : "closed");
}

/** Loop 4: re-open an approved case when a passport is superseded, revoked or stops verifying. */
async function monitoring(x: StepCtx) {
  const all = await x.repo.passports.list({ supplierId: x.supplier.id });
  const successors = x.po.passportIds
    .map((id) => ({ id, next: all.filter((p) => p.prevVersionId === id).sort((a, b) => b.version - a.version)[0] }))
    .filter((s) => s.next);
  if (successors.length) {
    const s = successors[0];
    const current = all.find((p) => p.id === s.id);
    x.po = {
      ...x.po,
      passportIds: x.po.passportIds.map((id) => successors.find((t) => t.id === id)?.next?.id ?? id),
      decision: "pending",
      decisionReasons: [],
    };
    await x.repo.purchaseOrders.put(x.po);
    x.c.decision = "pending";
    x.c.gaps = [];
    x.emit(
      `Change detected: ${x.supplier.legalName} issued passport v${s.next!.version} (${s.next!.id}) superseding v${current?.version ?? "?"} on PO ${x.po.id}. Re-opening the case and re-running checks.`,
      { superseded: s.id, newPassportId: s.next!.id },
      "system",
    );
    return x.go("screening");
  }
  for (const p of await loadPassports(x.repo, x.po.passportIds)) {
    const v = await verifyPassportJwt(p.jwt, x.repo);
    if (!v.valid) {
      x.po = { ...x.po, decision: "pending" };
      await x.repo.purchaseOrders.put(x.po);
      x.c.decision = "pending";
      const why = v.reason === "bad_signature" ? "signature no longer verifies" : `no longer verifies (${v.reason?.replace(/_/g, " ")})`;
      x.emit(`Monitoring: passport ${p.id} ${why}. Pulling PO ${x.po.id} back for re-evaluation; the order is held.`, { passportId: p.id, reason: v.reason }, "agent");
      return x.go("evaluating");
    }
  }
}

const HANDLERS: Partial<Record<AgentState, (x: StepCtx) => Promise<void>>> = {
  intake,
  screening,
  gap_analysis: gapAnalysis,
  requesting,
  awaiting_supplier: awaitingSupplier,
  ingesting,
  evaluating,
  deciding,
  signing,
  enforcing,
  monitoring,
};

/**
 * When the autopilot should next advance the case. Working states: after AGENT_STEP_DELAY_MS, so the
 * timeline visibly animates. Waiting on the supplier: poll the inbox every AGENT_TICK_MS (re-chase timing
 * is decided inside the step from the gaps' requestedAt). Monitoring: every tick. Final: never.
 */
function nextRunAt(x: StepCtx): string | undefined {
  if (FINAL_STATES.includes(x.c.state)) return undefined;
  const waiting = x.c.state === "awaiting_supplier" || x.c.state === "monitoring";
  return new Date(x.nowMs + (waiting ? env.tickMs() : env.stepDelayMs())).toISOString();
}

export const isDue = (c: AgentCase, nowMs = Date.now()) =>
  !FINAL_STATES.includes(c.state) && (!c.nextRunAt || Date.parse(c.nextRunAt) <= nowMs + 25);

// ---------- public API ----------

async function stepUnlocked(caseId: string, opts: AgentOptions): Promise<AgentStepResponse> {
  const repo = getRepo();
  const c = await repo.cases.get(caseId);
  if (!c) throw notFound("agent case", caseId);
  const po = await repo.purchaseOrders.get(c.purchaseOrderId);
  if (!po) throw notFound("purchase order", c.purchaseOrderId);
  const supplier = await repo.suppliers.get(c.supplierId);
  if (!supplier) throw notFound("supplier", c.supplierId);
  const policy = await repo.policies.get(po.buyerPolicyId);
  if (!policy) throw notFound("policy", po.buyerPolicyId);

  const date = opts.now?.() ?? new Date();
  if (opts.onlyIfDue && !isDue(c, date.getTime())) return { agentCase: c, newEvents: [] };
  const events: AgentEvent[] = [];
  const x: StepCtx = {
    repo,
    naive: opts.naive ?? getNaive(),
    now: date.toISOString(),
    nowMs: date.getTime(),
    rechaseSeconds: opts.rechaseSeconds ?? policy.rechaseIntervalSec,
    maxAttempts: opts.maxAttempts ?? policy.maxChaseAttempts,
    c: { ...c },
    po,
    supplier,
    policy,
    events,
    emit(summary, detail, actor = "agent") {
      events.push({ id: newId("evt"), caseId, at: x.now, state: x.c.state, actor, summary, ...(detail ? { detail } : {}) });
    },
    go(state) {
      x.c.state = state;
    },
  };

  const handler = HANDLERS[c.state];
  if (handler) {
    try {
      await handler(x);
    } catch (err) {
      x.c.escalationReason = `Agent error in ${c.state}: ${err instanceof Error ? err.message : String(err)}`;
      x.emit(`${x.c.escalationReason}. Escalating to a human.`, { error: String(err) }, "system");
      x.go("escalated");
    }
  }
  if (events.length || x.c.state !== c.state) x.c.updatedAt = x.now;
  x.c.nextRunAt = nextRunAt(x);
  for (const e of events) await repo.events.put(e);
  const agentCase = await repo.cases.put(x.c);
  return { agentCase, newEvents: events };
}

/**
 * Advance exactly one state. On the shared (Redis) store the step also holds a per-case Redis lock, pulls
 * the latest state first and commits afterwards; if another instance holds the lock it is a no-op.
 */
export function step(caseId: string, opts: AgentOptions = {}): Promise<AgentStepResponse> {
  return withLock(caseId, async () => {
    const repo = getRepo();
    if (!(repo instanceof RedisRepo)) return stepUnlocked(caseId, opts);
    const out = await repo.withCaseLock(caseId, async () => {
      await repo.sync();
      const res = await stepUnlocked(caseId, opts);
      await repo.commit();
      return res;
    });
    if (out) return out;
    const current = await repo.cases.get(caseId);
    if (!current) throw notFound("agent case", caseId);
    return { agentCase: current, newEvents: [] };
  });
}

/** Advance until the case rests (awaiting_supplier, monitoring, closed, escalated). Always takes at least one step. */
export async function run(caseId: string, opts: AgentOptions = {}, maxSteps = 40): Promise<AgentStepResponse> {
  const newEvents: AgentEvent[] = [];
  let res = await step(caseId, opts);
  newEvents.push(...res.newEvents);
  for (let i = 1; i < maxSteps && !RESTING_STATES.includes(res.agentCase.state); i++) {
    const before = res.agentCase.state;
    res = await step(caseId, opts);
    newEvents.push(...res.newEvents);
    if (res.agentCase.state === before && !res.newEvents.length) break;
  }
  return { agentCase: res.agentCase, newEvents };
}

/**
 * Drive a case to a settled outcome (closed / monitoring / escalated), stepping through supplier
 * waits too (pass rechaseSeconds: 0 to compress re-chase timing). For scripts and tests.
 */
export async function runToCompletion(caseId: string, opts: AgentOptions = {}, maxSteps = 80): Promise<AgentStepResponse> {
  const newEvents: AgentEvent[] = [];
  let res: AgentStepResponse | null = null;
  for (let i = 0; i < maxSteps; i++) {
    res = await step(caseId, opts);
    newEvents.push(...res.newEvents);
    const s = res.agentCase.state;
    if (s === "monitoring" || FINAL_STATES.includes(s)) break;
  }
  return { agentCase: res!.agentCase, newEvents };
}

/**
 * Heartbeat: advance open cases one step and return the ones that changed. With `onlyIfDue` (the
 * autopilot) only cases whose nextRunAt has passed are stepped; without it every open case is.
 */
export async function tick(opts: AgentOptions = {}): Promise<AgentStepResponse[]> {
  const nowMs = opts.now?.().getTime() ?? Date.now();
  await getRepo().sync?.();
  const cases = (await getRepo().cases.list()).filter((c) => (opts.onlyIfDue ? isDue(c, nowMs) : !FINAL_STATES.includes(c.state)));
  const results = await Promise.all(cases.map((c) => step(c.id, opts)));
  return results.filter((r, i) => r.newEvents.length > 0 || r.agentCase.state !== cases[i].state);
}

/** Open a case for a new purchase order (no human involved). */
export async function openCase(po: PurchaseOrder, at: string): Promise<AgentCase> {
  const repo = getRepo();
  const c: AgentCase = {
    id: newId("case"),
    purchaseOrderId: po.id,
    supplierId: po.supplierId,
    riskTier: po.riskTier,
    state: "intake",
    gaps: [],
    decision: "pending",
    nextRunAt: at,
    startedAt: at,
    updatedAt: at,
  };
  await repo.cases.put(c);
  await repo.events.put({ id: newId("evt"), caseId: c.id, at, state: "intake", actor: "system", summary: `Case opened automatically for PO ${po.id}.` });
  return c;
}

export async function appendEvent(e: Omit<AgentEvent, "id">): Promise<AgentEvent> {
  return getRepo().events.put({ id: newId("evt"), ...e });
}

/** Events for a case in order, optionally only those after `afterId`. */
export async function listEvents(caseId: string, afterId?: string | null): Promise<AgentEvent[]> {
  const repo = getRepo();
  if (!(await repo.cases.get(caseId))) throw notFound("agent case", caseId);
  const all = await repo.events.list({ caseId });
  if (!afterId) return all;
  const idx = all.findIndex((e) => e.id === afterId);
  return idx === -1 ? all : all.slice(idx + 1);
}

/**
 * Events across all cases, oldest to newest. With `afterId`: the next `limit` events after it (feed
 * polling). Without: the latest `limit` events.
 */
export async function listAllEvents(afterId?: string | null, limit = 50): Promise<AgentEvent[]> {
  const all = await getRepo().events.list();
  const n = Math.max(1, Math.min(1000, Math.floor(limit) || 50));
  if (!afterId) return all.slice(-n);
  const idx = all.findIndex((e) => e.id === afterId);
  return (idx === -1 ? all.slice(-n) : all.slice(idx + 1, idx + 1 + n));
}

/**
 * A passport was restored to its genuine signed JWT: re-open cases that were held because that passport
 * failed verification (F01), so the agent re-evaluates them through the normal path.
 */
export async function reopenAfterPassportRestore(passportId: string, at: string): Promise<string[]> {
  const repo = getRepo();
  const reopened: string[] = [];
  for (const po of await repo.purchaseOrders.list()) {
    if (!po.passportIds.includes(passportId) || po.humanOverride || po.decision === "approved") continue;
    const f01 = ((await repo.flagResults.get(po.id))?.flags ?? []).find((f) => f.flag === "F01_SIGNATURE_INVALID" && f.status === "flag");
    const failed = ((f01?.evidence.failures ?? []) as { passportId: string }[]).some((f) => f.passportId === passportId);
    const c = (await repo.cases.list({ purchaseOrderId: po.id })).at(-1);
    if (!failed || !c || c.state === "escalated") continue;
    await repo.purchaseOrders.put({ ...po, decision: "pending" });
    await repo.cases.put({ ...c, state: "evaluating", decision: "pending", nextRunAt: at, updatedAt: at });
    await repo.events.put({
      id: newId("evt"),
      caseId: c.id,
      at,
      state: "evaluating",
      actor: "system",
      summary: `Passport ${passportId} restored to its original signed version. Re-evaluating PO ${po.id}.`,
      detail: { passportId },
    });
    reopened.push(c.id);
  }
  return reopened;
}
