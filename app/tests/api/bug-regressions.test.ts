// Regression tests for QA-5 (webhook sender spoofing), QA-6 (500 body leak), QA-7 (identity gap).
import { beforeEach, describe, expect, it } from "vitest";
import { DEMO, type DemoRunResponse } from "@/contracts";
import { computeGaps } from "@/server/agent/requirements";
import { errorResponse } from "@/server/http";
import { getRepo } from "@/server/repo";
import { stopAutopilot, tickUntilResting, getPo } from "../helpers/demo";
import { call } from "../helpers/route";
import { routes } from "../helpers/routes";

const pdf = Buffer.from("%PDF-1.4 facility attestation 12 Mill Rd").toString("base64");

beforeEach(async () => {
  await stopAutopilot();
  await call(await routes.demoReset(), "POST", "/api/demo/reset");
});

async function startDemo() {
  const r = await call<DemoRunResponse>(await routes.demoRun(), "POST", "/api/demo/run");
  return r.body.results;
}

describe("QA-5 webhook sender verification", () => {
  it("evidence from a sender who is not the case supplier is ignored and logged", async () => {
    const c = (await startDemo()).find((r) => r.supplierLabel === "C")!;
    const r = await call(await routes.naiveWebhook(), "POST", "/api/webhooks/naive", {
      body: {
        providerMessageId: "evil-1",
        caseId: c.caseId,
        from: "Attacker <ops@evil.example>",
        subject: "facility attestation",
        body: "see attached",
        attachments: [{ filename: "facility.pdf", contentType: "application/pdf", base64: pdf }],
      },
    });
    expect(r.status).toBeLessThan(300);
    expect(r.body.ignored).toBe(true);
    const inbox = await getRepo().inbox.list({ caseId: c.caseId });
    expect(inbox.some((m) => m.message.from.includes("evil.example"))).toBe(false);
    const ev = await call<any[]>(await routes.agentEvents(), "GET", "/x", { params: { id: c.caseId } });
    expect(ev.body.some((e) => /unknown sender/i.test(e.summary))).toBe(true);
  });

  it("a reply from the supplier's contact is queued", async () => {
    const a = (await startDemo()).find((r) => r.supplierLabel === "A")!;
    const r = await call(await routes.naiveWebhook(), "POST", "/api/webhooks/naive", {
      body: { providerMessageId: "ok-1", caseId: a.caseId, from: DEMO.A.contactEmail, subject: "s", body: "b", attachments: [] },
    });
    expect(r.body.ignored).toBe(false);
    expect((await getRepo().inbox.list({ caseId: a.caseId })).length).toBe(1);
  });

  it("a caller-chosen providerMessageId cannot pre-empt the stub reply", async () => {
    const a = (await startDemo()).find((r) => r.supplierLabel === "A")!;
    await call(await routes.naiveWebhook(), "POST", "/api/webhooks/naive", {
      body: { providerMessageId: `stub-reply-${a.caseId}-0`, caseId: a.caseId, from: DEMO.A.contactEmail, subject: "s", body: "b", attachments: [] },
    });
    await tickUntilResting([a.caseId]);
    expect((await getPo(a.purchaseOrderId)).purchaseOrder.decision).toBe("approved");
  });
});

describe("QA-9 spoofed webhooks cannot force-escalate a case", () => {
  it("repeated replies from unknown senders are logged but leave the case running", async () => {
    const a = (await startDemo()).find((r) => r.supplierLabel === "A")!;
    const before = (await getRepo().cases.get(a.caseId))!;
    for (let i = 0; i < 5; i++) {
      const r = await call(await routes.naiveWebhook(), "POST", "/api/webhooks/naive", {
        body: { providerMessageId: `spoof-${i}`, caseId: a.caseId, from: "ops@evil.example", subject: "s", body: "b", attachments: [] },
      });
      expect(r.body.ignored).toBe(true);
    }
    const after = (await getRepo().cases.get(a.caseId))!;
    expect(after.state).toBe(before.state);
    expect(after.escalationReason).toBeUndefined();
    const ev = await call<any[]>(await routes.agentEvents(), "GET", "/x", { params: { id: a.caseId } });
    expect(ev.body.filter((e) => /unknown sender/i.test(e.summary)).length).toBeGreaterThanOrEqual(1);
    // The agent still reaches its normal decision.
    await tickUntilResting([a.caseId]);
    expect((await getPo(a.purchaseOrderId)).purchaseOrder.decision).toBe("approved");
  });
});

describe("POST /api/demo/run is idempotent until reset", () => {
  it("run -> 200, run again -> 409 { error, results } with the same POs, reset -> run -> 200; B quarantined after the re-run", async () => {
    const route = await routes.demoRun();
    const first = await call<DemoRunResponse>(route, "POST", "/api/demo/run");
    expect(first.status).toBe(200);

    const again = await call<{ error: string; results: DemoRunResponse["results"] }>(route, "POST", "/api/demo/run");
    expect(again.status).toBe(409);
    expect(typeof again.body.error).toBe("string");
    expect(again.body.results.map((r) => r.purchaseOrderId).sort()).toEqual(first.body.results.map((r) => r.purchaseOrderId).sort());
    const pos = await call<unknown[]>(await routes.purchaseOrders(), "GET", "/api/purchase-orders");
    expect(pos.body.length).toBe(3); // the second run created nothing

    expect((await call(await routes.demoReset(), "POST", "/api/demo/reset")).status).toBe(200);
    const rerun = await call<DemoRunResponse>(route, "POST", "/api/demo/run");
    expect(rerun.status).toBe(200);
    await tickUntilResting(rerun.body.results.map((r) => r.caseId));
    const b = rerun.body.results.find((r) => r.supplierLabel === "B")!;
    const detail = await getPo(b.purchaseOrderId);
    expect(detail.purchaseOrder.decision).toBe("quarantined");
    expect(detail.flags.filter((f) => f.status === "flag").map((f) => f.flag)).toEqual(["F10_UNDISCLOSED_SUBTIER_CHANGE"]);
  });
});

describe("QA-6 500 responses do not leak internals", () => {
  it("unexpected errors return a generic message", async () => {
    const res = errorResponse(new Error("ENOENT /Users/secret/.data/keys.json"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("/Users/secret");
  });
});

describe("QA-7 identity_field gap is resolvable", () => {
  const now = "2026-11-07T00:00:00.000Z";
  it("opens when the supplier has no UEI/EIN", () => {
    const g = computeGaps({ required: [], supplier: {}, documents: [], existing: [], now });
    expect(g.find((x) => x.kind === "identity_field")?.resolvedAt).toBeUndefined();
  });
  it("resolves once the supplier record gains a UEI or EIN", () => {
    const open = computeGaps({ required: [], supplier: {}, documents: [], existing: [], now });
    for (const supplier of [{ uei: "ABC123DEF456" }, { ein: "12-3456789" }]) {
      const g = computeGaps({ required: [], supplier, documents: [], existing: open, now });
      expect(g.find((x) => x.kind === "identity_field")?.resolvedAt).toBeTruthy();
    }
  });
});
