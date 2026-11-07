// Route handler tests against contracts/api.ts. Handlers are called directly with Request objects.
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AgentCase,
  AgentEvent,
  AgentStepResponse,
  AgentTickResponse,
  AutopilotStatus,
  BuyerPolicy,
  CreatePurchaseOrderResponse,
  DemoRunResponse,
  EnrollSupplierResponse,
  EvidenceDocument,
  ListSuppliersResponse,
  OutboundMessage,
  PartPassport,
  PurchaseOrderDetail,
  SupplierDetailResponse,
  VerifyResult,
} from "@/contracts";
import { DEMO } from "@/contracts";
import { getPo, listCases, runDemoToCompletion, stopAutopilot, tickUntilResting } from "../helpers/demo";
import { call } from "../helpers/route";
import { routes } from "../helpers/routes";

const enrollBody = {
  legalName: "Qa Test Fabrication LLC",
  domain: "qa-test-fab.example",
  address: { line1: "100 Industrial Way", city: "Dayton", state: "OH", zip: "45402", country: "US" },
  contactEmail: "compliance@qa-test-fab.example",
  claimedUsProduction: true,
};

beforeEach(async () => {
  await stopAutopilot();
  const r = await call(await routes.demoReset(), "POST", "/api/demo/reset");
  expect(r.status).toBe(200);
});

async function seededSuppliers() {
  const r = await call<ListSuppliersResponse>(await routes.suppliers(), "GET", "/api/suppliers");
  expect(r.status).toBe(200);
  return r.body;
}

async function firstSeededPassport(): Promise<PartPassport> {
  for (const s of await seededSuppliers()) {
    const d = await call<SupplierDetailResponse>(await routes.supplier(), "GET", `/api/suppliers/${s.supplier.id}`, {
      params: { id: s.supplier.id },
    });
    const p = d.body.passports.find((x) => !x.revoked);
    if (p) return p;
  }
  throw new Error("no seeded passport");
}

function expectApiError(r: { status: number; body: any }, status: number) {
  expect(r.status).toBe(status);
  expect(typeof r.body?.error).toBe("string");
}

describe("suppliers", () => {
  it("GET lists the three seeded demo suppliers", async () => {
    const list = await seededSuppliers();
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const s of list) {
      expect(s.supplier.id).toBeTruthy();
      expect(typeof s.openFlagCount).toBe("number");
    }
  });

  it("GET /suppliers/:id returns detail; unknown id is 404", async () => {
    const [s] = await seededSuppliers();
    const route = await routes.supplier();
    const ok = await call<SupplierDetailResponse>(route, "GET", `/api/suppliers/${s.supplier.id}`, { params: { id: s.supplier.id } });
    expect(ok.status).toBe(200);
    expect(ok.body.supplier.id).toBe(s.supplier.id);
    expect(Array.isArray(ok.body.checks)).toBe(true);
    expect(Array.isArray(ok.body.passports)).toBe(true);
    expect(Array.isArray(ok.body.documents)).toBe(true);
    expectApiError(await call(route, "GET", "/api/suppliers/nope", { params: { id: "nope" } }), 404);
  });

  it("POST enrolls a supplier, runs Loop 1 checks offline", async () => {
    const r = await call<EnrollSupplierResponse>(await routes.suppliers(), "POST", "/api/suppliers", { body: enrollBody });
    expect([200, 201]).toContain(r.status);
    expect(r.body.supplier.legalName).toBe(enrollBody.legalName);
    expect(r.body.checks.length).toBeGreaterThan(0);
    for (const c of r.body.checks) expect(c.source).toBe("fixture");
    const list = await seededSuppliers();
    expect(list.some((s) => s.supplier.id === r.body.supplier.id)).toBe(true);
  });

  it("POST rejects invalid bodies with 400 ApiError", async () => {
    const route = await routes.suppliers();
    expectApiError(await call(route, "POST", "/api/suppliers", { body: { legalName: "x" } }), 400);
    expectApiError(await call(route, "POST", "/api/suppliers", { body: { ...enrollBody, contactEmail: 42 } }), 400);
    expectApiError(await call(route, "POST", "/api/suppliers", { rawBody: "{not json" }), 400);
  });

  it("POST /suppliers/:id/documents stores a document with sha256", async () => {
    const [s] = await seededSuppliers();
    const content = Buffer.from("%PDF-1.4 qa test certificate").toString("base64");
    const r = await call<EvidenceDocument>(await routes.supplierDocuments(), "POST", `/api/suppliers/${s.supplier.id}/documents`, {
      params: { id: s.supplier.id },
      body: { kind: "test_report", filename: "qa.pdf", contentType: "application/pdf", base64: content },
    });
    expect([200, 201]).toContain(r.status);
    expect(r.body.supplierId).toBe(s.supplier.id);
    expect(r.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.receivedVia).toBe("upload");
  });

  it("documents upload rejects bad kind and unknown supplier", async () => {
    const [s] = await seededSuppliers();
    const route = await routes.supplierDocuments();
    const body = { kind: "not_a_kind", filename: "x.pdf", contentType: "application/pdf", base64: "eA==" };
    expectApiError(await call(route, "POST", "/x", { params: { id: s.supplier.id }, body }), 400);
    expectApiError(
      await call(route, "POST", "/x", { params: { id: "nope" }, body: { ...body, kind: "test_report" } }),
      404,
    );
  });
});

describe("passports + verify", () => {
  it("GET /passports/:id returns the passport; unknown is 404", async () => {
    const p = await firstSeededPassport();
    const route = await routes.passport();
    const r = await call<PartPassport>(route, "GET", `/api/passports/${p.id}`, { params: { id: p.id } });
    expect(r.status).toBe(200);
    expect(r.body.jwt).toBe(p.jwt);
    expectApiError(await call(route, "GET", "/x", { params: { id: "nope" } }), 404);
  });

  it("revoke makes verification fail with revoked", async () => {
    const p = await firstSeededPassport();
    const rev = await call<PartPassport>(await routes.passportRevoke(), "POST", `/api/passports/${p.id}/revoke`, {
      params: { id: p.id },
    });
    expect(rev.status).toBe(200);
    expect(rev.body.revoked).toBe(true);
    const v = await call<VerifyResult>(await routes.verify(), "POST", "/api/verify", { body: { jwt: p.jwt } });
    expect(v.body.valid).toBe(false);
    expect(v.body.revoked).toBe(true);
    expect(v.body.reason).toBe("revoked");
  });

  it("verify: garbage token is malformed, not a 500", async () => {
    const route = await routes.verify();
    for (const jwt of ["", "abc", "a.b.c", "x".repeat(50)]) {
      const v = await call<VerifyResult>(route, "POST", "/api/verify", { body: { jwt } });
      expect(v.status, `jwt=${JSON.stringify(jwt)}`).toBeLessThan(500);
      if (v.status === 200) {
        expect(v.body.valid).toBe(false);
        expect(v.body.reason).toBe("malformed");
      }
    }
    expectApiError(await call(route, "POST", "/api/verify", { body: {} }), 400);
  });

  it("verify: alg=none token with a valid-looking payload is rejected", async () => {
    const p = await firstSeededPassport();
    const [, payload] = p.jwt.split(".");
    const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${payload}.`;
    const v = await call<VerifyResult>(await routes.verify(), "POST", "/api/verify", { body: { jwt: none } });
    expect(v.status).toBeLessThan(500);
    expect(v.body.valid).toBe(false);
  });

  it("POST /passports creates a signed, verifiable passport with computed domestic content", async () => {
    const r0 = await call<EnrollSupplierResponse>(await routes.suppliers(), "POST", "/api/suppliers", { body: enrollBody });
    const supplierId = r0.body.supplier.id;
    const r = await call<PartPassport>(await routes.passports(), "POST", "/api/passports", {
      body: {
        supplierId,
        serialOrBatch: "QA-BATCH-1",
        model: "QA-1",
        spec: "test",
        components: [
          { name: "housing", supplierName: "US Co", countryOfOrigin: "US", costUsd: 75 },
          { name: "chip", supplierName: "Foreign Co", countryOfOrigin: "TW", costUsd: 25 },
        ],
        testCertificateDocumentIds: [],
      },
    });
    expect([200, 201]).toContain(r.status);
    expect(r.body.totalCostUsd).toBe(100);
    expect(r.body.domesticContentRatio).toBeCloseTo(0.75, 5);
    expect(r.body.version).toBe(1);
    const v = await call<VerifyResult>(await routes.verify(), "POST", "/api/verify", { body: { jwt: r.body.jwt } });
    expect(v.body.valid).toBe(true);
  });

  it("POST /passports rejects unknown supplier / bad components", async () => {
    const route = await routes.passports();
    const base = { serialOrBatch: "x", model: "x", spec: "x", components: [], testCertificateDocumentIds: [] };
    const r1 = await call(route, "POST", "/api/passports", { body: { ...base, supplierId: "nope" } });
    expect([400, 404]).toContain(r1.status);
    const [s] = await seededSuppliers();
    expectApiError(
      await call(route, "POST", "/api/passports", {
        body: { ...base, supplierId: s.supplier.id, components: [{ name: "x", costUsd: "free" }] },
      }),
      400,
    );
  });
});

describe("purchase orders + agent routes", () => {
  async function createPo() {
    const p = await firstSeededPassport();
    const r = await call<CreatePurchaseOrderResponse>(await routes.purchaseOrders(), "POST", "/api/purchase-orders", {
      body: { supplierId: p.supplierId, passportIds: [p.id], riskTier: "high", amountUsd: 10000 },
    });
    expect([200, 201]).toContain(r.status);
    return r.body;
  }

  it("creating a PO auto-starts an agent case", async () => {
    const { purchaseOrder, agentCase } = await createPo();
    expect(agentCase.purchaseOrderId).toBe(purchaseOrder.id);
    expect(agentCase.supplierId).toBe(purchaseOrder.supplierId);
    const cases = await call<AgentCase[]>(await routes.agentCases(), "GET", "/api/agent/cases");
    expect(cases.body.some((c) => c.id === agentCase.id)).toBe(true);
  });

  it("PO create validates input", async () => {
    const route = await routes.purchaseOrders();
    const p = await firstSeededPassport();
    expectApiError(
      await call(route, "POST", "/api/purchase-orders", {
        body: { supplierId: p.supplierId, passportIds: [p.id], riskTier: "extreme", amountUsd: 1 },
      }),
      400,
    );
    expectApiError(
      await call(route, "POST", "/api/purchase-orders", {
        body: { supplierId: p.supplierId, passportIds: [p.id], riskTier: "low", amountUsd: "lots" },
      }),
      400,
    );
  });

  it("step advances exactly one state and returns its events", async () => {
    const { agentCase } = await createPo();
    const r = await call<AgentStepResponse>(await routes.agentStep(), "POST", `/x`, { params: { id: agentCase.id } });
    expect(r.status).toBe(200);
    expect(r.body.agentCase.id).toBe(agentCase.id);
    expect(r.body.newEvents.length).toBeGreaterThan(0);
  });

  it("run advances to a resting state; events?after= returns only newer events", async () => {
    const { agentCase } = await createPo();
    const r = await call<AgentStepResponse>(await routes.agentRun(), "POST", `/x`, { params: { id: agentCase.id } });
    expect(r.status).toBe(200);
    expect(["awaiting_supplier", "closed", "escalated", "monitoring"]).toContain(r.body.agentCase.state);
    const evRoute = await routes.agentEvents();
    const all = await call<AgentEvent[]>(evRoute, "GET", "/x", { params: { id: agentCase.id } });
    expect(all.body.length).toBeGreaterThan(1);
    const after = await call<AgentEvent[]>(evRoute, "GET", "/x", {
      params: { id: agentCase.id },
      query: { after: all.body[0].id },
    });
    expect(after.body.map((e) => e.id)).toEqual(all.body.slice(1).map((e) => e.id));
  });

  it("unknown case id is 404 on step/run/events", async () => {
    for (const r of [routes.agentStep, routes.agentRun]) expectApiError(await call(await r(), "POST", "/x", { params: { id: "nope" } }), 404);
    expectApiError(await call(await routes.agentEvents(), "GET", "/x", { params: { id: "nope" } }), 404);
  });

  it("tick advances open cases", async () => {
    await createPo();
    const r = await call<AgentTickResponse>(await routes.agentTick(), "POST", "/api/agent/tick");
    expect(r.status).toBe(200);
    expect(r.body.advanced.length).toBeGreaterThan(0);
  });

  it("outbox lists stub messages", async () => {
    const r = await call<OutboundMessage[]>(await routes.agentOutbox(), "GET", "/api/agent/outbox");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    for (const m of r.body) expect(m.provider).toBe("stub");
  });

  it("GET /purchase-orders/:id 404s for unknown", async () => {
    expectApiError(await call(await routes.purchaseOrder(), "GET", "/x", { params: { id: "nope" } }), 404);
  });

  it("override records a human decision with reason; rejects pending/empty reason", async () => {
    const { run } = await runDemoToCompletion();
    const c = run.results.find((r) => r.supplierLabel === "C")!;
    const route = await routes.purchaseOrderOverride();
    expectApiError(await call(route, "POST", "/x", { params: { id: c.purchaseOrderId }, body: { decision: "pending", reason: "x" } }), 400);
    expectApiError(await call(route, "POST", "/x", { params: { id: c.purchaseOrderId }, body: { decision: "approved", reason: "" } }), 400);
    expectApiError(await call(route, "POST", "/x", { params: { id: "nope" }, body: { decision: "approved", reason: "ok" } }), 404);
    const ok = await call(route, "POST", "/x", {
      params: { id: c.purchaseOrderId },
      body: { decision: "approved", reason: "QA override after manual audit" },
    });
    expect(ok.status).toBe(200);
    const d = await call<PurchaseOrderDetail>(await routes.purchaseOrder(), "GET", "/x", { params: { id: c.purchaseOrderId } });
    expect(d.body.purchaseOrder.humanOverride?.decision).toBe("approved");
    expect(d.body.purchaseOrder.humanOverride?.reason).toBe("QA override after manual audit");
  });
});

describe("policy", () => {
  it("GET returns the spec policy (1 flag quarantines, 2 block, 0.65 threshold)", async () => {
    const r = await call<BuyerPolicy>(await routes.policy(), "GET", "/api/policy");
    expect(r.status).toBe(200);
    expect(r.body.quarantineAtFlagCount).toBe(1);
    expect(r.body.blockAtFlagCount).toBe(2);
    expect(r.body.domesticContentThreshold).toBeCloseTo(0.65);
    // High tier is a superset of medium, medium of low (spec risk tiers).
    const { low, medium, high } = r.body.tierFlags;
    for (const f of low) expect(medium).toContain(f);
    for (const f of medium) expect(high).toContain(f);
    expect(low).toContain("F01_SIGNATURE_INVALID");
    expect(high).toContain("F10_UNDISCLOSED_SUBTIER_CHANGE");
  });

  it("a domestic-content ratio below the policy threshold changes the decision", async () => {
    const route = await routes.policy();
    const cur = (await call<BuyerPolicy>(route, "GET", "/api/policy")).body;
    const sup = await call<SupplierDetailResponse>(await routes.supplier(), "GET", "/x", { params: { id: DEMO.A.supplierId } });
    expect(sup.status).toBe(200);
    const ratio = Math.min(...sup.body.passports.map((p) => p.domesticContentRatio));
    expect(ratio, "A's passport must sit above the default threshold").toBeGreaterThanOrEqual(cur.domesticContentThreshold);
    expect(ratio, "need headroom above A's ratio to raise the threshold").toBeLessThan(1);
    const put = await call(route, "PUT", "/api/policy", {
      body: { ...cur, domesticContentThreshold: Math.min(1, ratio + 0.01) },
    });
    expect(put.status).toBe(200);
    const run = await call<DemoRunResponse>(await routes.demoRun(), "POST", "/api/demo/run");
    expect(run.status).toBe(200);
    await tickUntilResting(run.body.results.map((r) => r.caseId));
    const a = await getPo(run.body.results.find((r) => r.supplierLabel === "A")!.purchaseOrderId);
    expect(a.purchaseOrder.decision).not.toBe("approved");
    expect(a.purchaseOrder.decisionReasons.join(" ").toLowerCase()).toMatch(/domestic/);
  });

  it("PUT updates and persists; invalid bodies are 400", async () => {
    const route = await routes.policy();
    const cur = (await call<BuyerPolicy>(route, "GET", "/api/policy")).body;
    const put = await call<BuyerPolicy>(route, "PUT", "/api/policy", { body: { ...cur, domesticContentThreshold: 0.75 } });
    expect(put.status).toBe(200);
    expect((await call<BuyerPolicy>(route, "GET", "/api/policy")).body.domesticContentThreshold).toBeCloseTo(0.75);
    expectApiError(await call(route, "PUT", "/api/policy", { body: { ...cur, domesticContentThreshold: 7 } }), 400);
    expectApiError(await call(route, "PUT", "/api/policy", { body: { ...cur, tierFlags: { low: ["F99_FAKE"] } } }), 400);
  });
});

describe("naive webhook", () => {
  it("rejects garbage without crashing", async () => {
    const r = await call(await routes.naiveWebhook(), "POST", "/api/webhooks/naive", { rawBody: "nope" });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
});

describe("autopilot", () => {
  it("GET reports status; POST toggles it", async () => {
    const route = await routes.agentAutopilot();
    const g = await call<AutopilotStatus>(route, "GET", "/api/agent/autopilot");
    expect(g.status).toBe(200);
    expect(typeof g.body.enabled).toBe("boolean");
    expect(typeof g.body.intervalMs).toBe("number");
    expect(typeof g.body.openCases).toBe("number");
    const on = await call<AutopilotStatus>(route, "POST", "/api/agent/autopilot", { body: { enabled: true } });
    expect(on.status).toBe(200);
    expect(on.body.enabled).toBe(true);
    const off = await call<AutopilotStatus>(route, "POST", "/api/agent/autopilot", { body: { enabled: false } });
    expect(off.body.enabled).toBe(false);
    expectApiError(await call(route, "POST", "/api/agent/autopilot", { body: { enabled: "yes" } }), 400);
  });

  it("with autopilot on, demo cases reach a decision with no tick/step/run calls", async () => {
    const route = await routes.agentAutopilot();
    const run = await call<DemoRunResponse>(await routes.demoRun(), "POST", "/api/demo/run");
    expect(run.status).toBe(200);
    await call(route, "POST", "/api/agent/autopilot", { body: { enabled: true } });
    try {
      const ids = run.body.results.map((r) => r.caseId);
      const deadline = Date.now() + 25000;
      let cases = await listCases();
      while (Date.now() < deadline && !ids.every((id) => ["closed", "monitoring"].includes(cases.find((c) => c.id === id)?.state ?? ""))) {
        await new Promise((r) => setTimeout(r, 200));
        cases = await listCases();
      }
      for (const r of run.body.results) {
        const c = cases.find((x) => x.id === r.caseId)!;
        expect({ label: r.supplierLabel, decision: c.decision }).toEqual({ label: r.supplierLabel, decision: DEMO[r.supplierLabel].expected });
      }
      const status = await call<AutopilotStatus>(route, "GET", "/api/agent/autopilot");
      expect(status.body.lastTickAt).not.toBeNull();
    } finally {
      await call(route, "POST", "/api/agent/autopilot", { body: { enabled: false } });
    }
  });
});

describe("integration status checkSources (v2.4)", () => {
  it("reports live per check when that check's key is set, without making calls", async () => {
    process.env.SAM_GOV_API_KEY = "qa-dummy";
    process.env.LIVE_PUBLIC_LOOKUPS = "1";
    try {
      const r = await call<import("@/contracts").IntegrationStatus>(await routes.integrations(), "GET", "/api/integrations/status");
      expect(r.body.samGov).toBe("live");
      expect(r.body.checkSources.sam_registration).toBe("live");
      expect(r.body.checkSources.domain_age).toBe("live");
      expect(r.body.checkSources.sanctions).toBe("live");
      expect(r.body.checkSources.address_cmra).toBe("fixture");
      expect(r.body.checkSources.shipping_history).toBe("fixture");
    } finally {
      delete process.env.SAM_GOV_API_KEY;
      delete process.env.LIVE_PUBLIC_LOOKUPS;
    }
  });
});
