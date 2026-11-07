// B7 autonomous agent: happy path, events per transition, Naive sends, re-chase -> escalation,
// Loop 4 re-open. Fully offline (no env keys; any fetch throws).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentCase, AgentState, NaiveInboundMessage, NaivePort, NaiveSendRequest, OutboundMessage } from "@/contracts";
import { DEMO } from "@/contracts";
import { RESTING_STATES, listEvents, run, runToCompletion, step, tick } from "@/server/agent";
import { getNaive } from "@/server/naive";
import { getRepo } from "@/server/repo";
import { resetDemo } from "@/server/seed";
import { createPassport } from "@/server/services/passports";
import { createPurchaseOrder } from "@/server/services/purchaseOrders";
import { tamperPassport } from "@/server/services/demo";
import { enrollSupplier } from "@/server/services/suppliers";
import { trapFetch } from "../helpers/route";

const repo = getRepo();
let net: ReturnType<typeof trapFetch>;
beforeAll(() => {
  net = trapFetch();
});
afterAll(() => {
  net.restore();
});
beforeEach(async () => {
  await resetDemo();
});

/** Wraps a NaivePort and records every send; `silent` drops all supplier replies. */
function recordingNaive(opts: { silent?: boolean; failSend?: boolean } = {}) {
  const inner = getNaive();
  const sent: NaiveSendRequest[] = [];
  const port: NaivePort = {
    mode: "stub",
    async sendMessage(req) {
      sent.push(req);
      if (opts.failSend) throw new Error("SMTP down");
      return inner.sendMessage(req);
    },
    async fetchInbound(caseId): Promise<NaiveInboundMessage[]> {
      return opts.silent ? [] : inner.fetchInbound(caseId);
    },
    parseWebhook: (b, h) => inner.parseWebhook(b, h),
  };
  return { port, sent };
}

async function demoPo(label: "A" | "B" | "C") {
  const passportId = { A: "pp_A_1", B: "pp_B_1", C: "pp_C_1" }[label];
  return createPurchaseOrder({ supplierId: DEMO[label].supplierId, passportIds: [passportId], riskTier: "high", amountUsd: 1000 });
}

/** Step one at a time, asserting every state change emitted at least one event. */
async function stepToRest(caseId: string, opts: Parameters<typeof step>[1], max = 60) {
  const trail: AgentState[] = [];
  let c: AgentCase | null = null;
  for (let i = 0; i < max; i++) {
    const before = (await repo.cases.get(caseId))!.state;
    const r = await step(caseId, opts);
    c = r.agentCase;
    if (c.state !== before) {
      expect(r.newEvents.length, `transition ${before} -> ${c.state} emitted no event`).toBeGreaterThan(0);
      for (const e of r.newEvents) expect(e.caseId).toBe(caseId);
      trail.push(c.state);
    }
    if (c.state === "monitoring" || c.state === "closed" || c.state === "escalated") break;
  }
  return { c: c!, trail };
}

describe("happy path (supplier A)", () => {
  it("runs intake -> ... -> monitoring, approved, with an event on every transition", async () => {
    const { agentCase, purchaseOrder } = await demoPo("A");
    expect(agentCase.state).toBe("intake");
    const { c, trail } = await stepToRest(agentCase.id, { rechaseSeconds: 0 });
    expect(c.state).toBe("monitoring");
    expect(c.decision).toBe("approved");
    for (const s of ["screening", "gap_analysis", "requesting", "awaiting_supplier", "ingesting", "evaluating", "deciding", "signing", "enforcing", "monitoring"])
      expect(trail).toContain(s);
    const po = await repo.purchaseOrders.get(purchaseOrder.id);
    expect(po?.decision).toBe("approved");
    expect(po?.decisionJwt).toBeTruthy();
  });

  it("A's missing facility attestation triggers exactly one Naive send, recorded in the outbox", async () => {
    const { agentCase } = await demoPo("A");
    const { port, sent } = recordingNaive();
    await stepToRest(agentCase.id, { naive: port, rechaseSeconds: 0 });
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe(DEMO.A.contactEmail);
    expect(sent[0].caseId).toBe(agentCase.id);
    expect(sent[0].body.toLowerCase()).toContain("facility");
    const outbox = await repo.outbox.list({ caseId: agentCase.id });
    expect(outbox.length).toBe(1);
    expect(outbox[0].provider).toBe("stub");
    const ingested = await repo.documents.list({ supplierId: DEMO.A.supplierId });
    expect(ingested.some((d) => d.receivedVia === "naive_inbox" && d.kind === "facility_attestation")).toBe(true);
  });

  it("run() stops at a resting state; runToCompletion() reaches the decision", async () => {
    const { agentCase } = await demoPo("A");
    const r = await run(agentCase.id, { rechaseSeconds: 3600 });
    expect(RESTING_STATES).toContain(r.agentCase.state);
    expect(r.agentCase.state).toBe("awaiting_supplier");
    const done = await runToCompletion(agentCase.id, { rechaseSeconds: 0 });
    expect(done.agentCase.state).toBe("monitoring");
  });

  it("B -> quarantined via the reply's passport v2 (PO switches to the new version)", async () => {
    const { agentCase, purchaseOrder } = await demoPo("B");
    const r = await runToCompletion(agentCase.id, { rechaseSeconds: 0 });
    expect(r.agentCase.decision).toBe("quarantined");
    expect(r.agentCase.state).toBe("closed");
    expect((await repo.purchaseOrders.get(purchaseOrder.id))?.passportIds).toEqual(["pp_B_2"]);
  });

  it("C -> blocked", async () => {
    const { agentCase } = await demoPo("C");
    expect((await runToCompletion(agentCase.id, { rechaseSeconds: 0 })).agentCase.decision).toBe("blocked");
  });
});

describe("re-chase -> escalation (unresponsive supplier)", () => {
  it("does not re-chase before the interval, re-chases after it with incrementing attempts, then escalates", async () => {
    const { agentCase } = await demoPo("A");
    const { port, sent } = recordingNaive({ silent: true });
    let t = Date.parse("2026-11-07T12:00:00Z");
    const opts = () => ({ naive: port, rechaseSeconds: 60, maxAttempts: 3, now: () => new Date(t) });

    await run(agentCase.id, opts());
    let c = (await repo.cases.get(agentCase.id))!;
    expect(c.state).toBe("awaiting_supplier");
    expect(sent.length).toBe(1);
    expect(c.gaps.find((g) => !g.resolvedAt)?.attempts).toBe(1);

    t += 30_000; // before the interval: keep waiting, no send
    await step(agentCase.id, opts());
    expect((await repo.cases.get(agentCase.id))!.state).toBe("awaiting_supplier");
    expect(sent.length).toBe(1);

    for (const attempt of [2, 3]) {
      t += 61_000;
      await run(agentCase.id, opts());
      c = (await repo.cases.get(agentCase.id))!;
      expect(c.state).toBe("awaiting_supplier");
      expect(sent.length).toBe(attempt);
      expect(c.gaps.filter((g) => !g.resolvedAt).every((g) => g.attempts === attempt)).toBe(true);
    }

    t += 61_000;
    await run(agentCase.id, opts());
    c = (await repo.cases.get(agentCase.id))!;
    expect(c.state).toBe("escalated");
    expect(c.decision).toBe("pending");
    expect(c.escalationReason).toMatch(/unresponsive/i);
    expect(sent.length).toBe(3);
    expect(await repo.outbox.list({ caseId: agentCase.id })).toHaveLength(3);
    const events = await listEvents(agentCase.id);
    expect(events.filter((e) => /re-chased/i.test(e.summary)).length).toBe(2);
    expect(events.at(-1)?.state).toBe("awaiting_supplier"); // emitted while leaving awaiting -> escalated
  });

  it("escalated cases are not advanced by tick()", async () => {
    const { agentCase } = await demoPo("A");
    const { port } = recordingNaive({ silent: true });
    await runToCompletion(agentCase.id, { naive: port, rechaseSeconds: 0, maxAttempts: 1 });
    expect((await repo.cases.get(agentCase.id))!.state).toBe("escalated");
    const before = (await listEvents(agentCase.id)).length;
    const advanced = await tick({ naive: port });
    expect(advanced.find((r) => r.agentCase.id === agentCase.id)).toBeUndefined();
    expect((await listEvents(agentCase.id)).length).toBe(before);
  });

  it("a supplier with no fixture reply (newly enrolled) escalates on the default stub", async () => {
    const { supplier } = await enrollSupplier({
      legalName: "Quiet Parts LLC",
      domain: "quietparts.example",
      address: { line1: "9 Elm St", city: "Troy", state: "NY", zip: "12180", country: "US" },
      contactEmail: "q@quietparts.example",
      claimedUsProduction: true,
    });
    const p = await createPassport({
      supplierId: supplier.id,
      serialOrBatch: "Q-1",
      model: "Q",
      spec: "q",
      components: [{ name: "body", supplierName: "Quiet", countryOfOrigin: "US", costUsd: 10 }],
      testCertificateDocumentIds: [],
    });
    const { agentCase } = await createPurchaseOrder({ supplierId: supplier.id, passportIds: [p.id], riskTier: "medium", amountUsd: 10 });
    const r = await runToCompletion(agentCase.id, { rechaseSeconds: 0 });
    expect(r.agentCase.state).toBe("escalated");
  });

  it("a send failure escalates instead of crashing", async () => {
    const { agentCase } = await demoPo("A");
    const { port } = recordingNaive({ failSend: true });
    const r = await runToCompletion(agentCase.id, { naive: port, rechaseSeconds: 0 });
    expect(r.agentCase.state).toBe("escalated");
    expect(r.agentCase.escalationReason).toMatch(/SMTP down/);
  });
});

describe("Loop 4 monitoring re-opens an approved case", () => {
  async function approvedA() {
    const res = await demoPo("A");
    const r = await runToCompletion(res.agentCase.id, { rechaseSeconds: 0 });
    expect(r.agentCase.state).toBe("monitoring");
    return res;
  }

  it("a new passport version re-opens the case, re-runs checks and re-decides", async () => {
    const { agentCase, purchaseOrder } = await approvedA();
    const v1 = (await repo.passports.get("pp_A_1"))!;
    const v2 = await createPassport({
      supplierId: v1.supplierId,
      serialOrBatch: `${v1.serialOrBatch}-R2`,
      model: v1.model,
      spec: v1.spec,
      components: v1.components.map((c, i) => (i === 0 ? { ...c, supplierName: "Shenzhen Parts", countryOfOrigin: "CN" } : c)),
      testCertificateDocumentIds: [],
      prevVersionId: v1.id,
    });
    const s = await step(agentCase.id, { rechaseSeconds: 0 });
    expect(s.agentCase.state).not.toBe("monitoring");
    expect(s.agentCase.decision).toBe("pending");
    expect(s.newEvents.some((e) => /change detected/i.test(e.summary))).toBe(true);
    expect((await repo.purchaseOrders.get(purchaseOrder.id))?.passportIds).toEqual([v2.id]);
    const r = await runToCompletion(agentCase.id, { rechaseSeconds: 0 });
    expect(r.agentCase.decision).not.toBe("approved"); // undisclosed move to CN -> F10
    expect((await repo.flagResults.get(purchaseOrder.id))?.flags.find((f) => f.flag === "F10_UNDISCLOSED_SUBTIER_CHANGE")?.status).toBe("flag");
  });

  it("a passport that stops verifying (tamper) pulls the approved PO back and quarantines it (F01)", async () => {
    const { agentCase, purchaseOrder } = await approvedA();
    await tamperPassport({ passportId: "pp_A_1", path: "components.0.countryOfOrigin", value: "CN" });
    const r = await runToCompletion(agentCase.id, { rechaseSeconds: 0 });
    expect(r.agentCase.decision).toBe("quarantined");
    const flags = (await repo.flagResults.get(purchaseOrder.id))!.flags;
    expect(flags.find((f) => f.flag === "F01_SIGNATURE_INVALID")?.status).toBe("flag");
  });

  it("monitoring with nothing changed stays in monitoring and emits nothing", async () => {
    const { agentCase } = await approvedA();
    const s = await step(agentCase.id, {});
    expect(s.agentCase.state).toBe("monitoring");
    expect(s.newEvents).toEqual([]);
  });
});

describe("offline", () => {
  it("made no outbound network calls", () => {
    expect(net.calls).toEqual([]);
  });
  it("outbox messages are stub-provider only", async () => {
    const { agentCase } = await demoPo("A");
    await runToCompletion(agentCase.id, { rechaseSeconds: 0 });
    const all: OutboundMessage[] = await repo.outbox.list();
    expect(all.every((m) => m.provider === "stub")).toBe(true);
  });
});
