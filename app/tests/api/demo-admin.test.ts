// Contract v2.1-v2.3 routes: global event feed, restore-passport, tamper guard, DEMO_ADMIN_TOKEN auth.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent, PartPassport, PurchaseOrderDetail, VerifyResult } from "@/contracts";
import { getPo, runDemoToCompletion, stopAutopilot, tickUntilResting } from "../helpers/demo";
import { call } from "../helpers/route";
import { routes } from "../helpers/routes";

const verify = async (jwt: string) =>
  (await call<VerifyResult>(await routes.verify(), "POST", "/api/verify", { body: { jwt } })).body;
const passport = async (id: string) =>
  (await call<PartPassport>(await routes.passport(), "GET", `/api/passports/${id}`, { params: { id } })).body;
const tamper = async (body: unknown, headers?: Record<string, string>) =>
  call(await routes.demoTamper(), "POST", "/api/demo/tamper", { body, headers });

beforeEach(async () => {
  await stopAutopilot();
  await call(await routes.demoReset(), "POST", "/api/demo/reset");
});

describe("GET /api/agent/events (all cases)", () => {
  it("without after: newest <limit> events, oldest -> newest; with after: the next <limit>", async () => {
    await runDemoToCompletion();
    const route = await routes.agentAllEvents();
    const all = (await call<AgentEvent[]>(route, "GET", "/api/agent/events", { query: { limit: "1000" } })).body;
    expect(all.length).toBeGreaterThan(20);
    expect(new Set(all.map((e) => e.caseId)).size).toBe(3);

    const def = (await call<AgentEvent[]>(route, "GET", "/api/agent/events")).body;
    expect(def.length).toBe(Math.min(50, all.length));
    expect(def.map((e) => e.id)).toEqual(all.slice(-def.length).map((e) => e.id));

    const newest5 = (await call<AgentEvent[]>(route, "GET", "/api/agent/events", { query: { limit: "5" } })).body;
    expect(newest5.map((e) => e.id)).toEqual(all.slice(-5).map((e) => e.id));

    const next3 = (await call<AgentEvent[]>(route, "GET", "/api/agent/events", { query: { after: all[2].id, limit: "3" } })).body;
    expect(next3.map((e) => e.id)).toEqual(all.slice(3, 6).map((e) => e.id));

    const tail = (await call<AgentEvent[]>(route, "GET", "/api/agent/events", { query: { after: all.at(-1)!.id } })).body;
    expect(tail).toEqual([]);
  });

  it("bad limit values do not 500", async () => {
    const route = await routes.agentAllEvents();
    for (const limit of ["0", "-5", "abc", "99999"]) {
      const r = await call(route, "GET", "/api/agent/events", { query: { limit } });
      expect(r.status, `limit=${limit}`).toBeLessThan(500);
    }
  });
});

describe("POST /api/demo/tamper guard", () => {
  it("a no-op tamper (value unchanged) is 400, not a silently valid passport", async () => {
    const p = await passport("pp_A_1");
    const current = p.components[0].countryOfOrigin;
    const r = await tamper({ passportId: "pp_A_1", path: "components.0.countryOfOrigin", value: current });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/unchanged/);
    expect((await passport("pp_A_1")).jwt).toBe(p.jwt);
  });

  it("repeating the same tamper is 400 the second time", async () => {
    const body = { passportId: "pp_A_1", path: "components.0.countryOfOrigin", value: "CN" };
    expect((await tamper(body)).status).toBe(200);
    expect((await tamper(body)).status).toBe(400);
  });

  it("bad path is 400, unknown passport is 404, bad body is 400", async () => {
    expect((await tamper({ passportId: "pp_A_1", path: "nope.0.x", value: 1 })).status).toBe(400);
    expect((await tamper({ passportId: "pp_nope", path: "model", value: "x" })).status).toBe(404);
    expect((await tamper({ passportId: "pp_A_1" })).status).toBe(400);
  });
});

describe("POST /api/demo/restore-passport", () => {
  it("restores the genuine JWT byte-for-byte without wiping POs", async () => {
    const original = await passport("pp_A_1");
    await tamper({ passportId: "pp_A_1", path: "model", value: "FAKE" });
    expect((await verify((await passport("pp_A_1")).jwt)).reason).toBe("bad_signature");
    const r = await call<PartPassport>(await routes.demoRestorePassport(), "POST", "/api/demo/restore-passport", {
      body: { passportId: "pp_A_1" },
    });
    expect(r.status).toBe(200);
    expect(r.body.jwt).toBe(original.jwt);
    expect((await verify(r.body.jwt)).valid).toBe(true);
  });

  it("re-opens the case the tamper held and the agent re-approves it", async () => {
    const { run } = await runDemoToCompletion();
    const a = run.results.find((r) => r.supplierLabel === "A")!;
    expect((await getPo(a.purchaseOrderId)).purchaseOrder.decision).toBe("approved");

    await tamper({ passportId: "pp_A_1", path: "components.0.countryOfOrigin", value: "CN" });
    await tickUntilResting([a.caseId]); // monitoring may need a tick to notice
    let d: PurchaseOrderDetail = await getPo(a.purchaseOrderId);
    // Loop 4: approved case notices the broken signature and holds the PO.
    for (let i = 0; i < 20 && d.purchaseOrder.decision === "approved"; i++) {
      await call(await routes.agentTick(), "POST", "/api/agent/tick");
      d = await getPo(a.purchaseOrderId);
    }
    expect(d.purchaseOrder.decision).toBe("quarantined");
    expect(d.flags.find((f) => f.flag === "F01_SIGNATURE_INVALID")?.status).toBe("flag");

    const r = await call(await routes.demoRestorePassport(), "POST", "/api/demo/restore-passport", { body: { passportId: "pp_A_1" } });
    expect(r.status).toBe(200);
    for (let i = 0; i < 30 && d.purchaseOrder.decision !== "approved"; i++) {
      await call(await routes.agentTick(), "POST", "/api/agent/tick");
      d = await getPo(a.purchaseOrderId);
    }
    expect(d.purchaseOrder.decision).toBe("approved");
    expect(d.agentCase?.state).toBe("monitoring");
    // Other POs untouched.
    const pos = await call<PurchaseOrderDetail[]>(await routes.purchaseOrders(), "GET", "/api/purchase-orders");
    expect(pos.body.length).toBe(3);
  });

  it("unknown passport is 404; missing body is 400", async () => {
    const route = await routes.demoRestorePassport();
    expect((await call(route, "POST", "/x", { body: { passportId: "pp_nope" } })).status).toBe(404);
    expect((await call(route, "POST", "/x", { body: {} })).status).toBe(400);
  });
});

describe("DEMO_ADMIN_TOKEN (public deploy guard)", () => {
  beforeEach(() => {
    process.env.DEMO_ADMIN_TOKEN = "qa-secret";
  });
  afterEach(() => {
    delete process.env.DEMO_ADMIN_TOKEN;
    delete process.env.NAIVE_WEBHOOK_SECRET;
  });

  it("non-GET routes return 401 without x-demo-token and do nothing", async () => {
    const before = await passport("pp_A_1");
    const cases: [keyof typeof routes, "POST" | "PUT", string, unknown?, Record<string, string>?][] = [
      ["demoReset", "POST", "/api/demo/reset"],
      ["demoRun", "POST", "/api/demo/run"],
      ["demoTamper", "POST", "/api/demo/tamper", { passportId: "pp_A_1", path: "model", value: "X" }],
      ["demoRestorePassport", "POST", "/api/demo/restore-passport", { passportId: "pp_A_1" }],
      ["agentTick", "POST", "/api/agent/tick"],
      ["agentAutopilot", "POST", "/api/agent/autopilot", { enabled: true }],
      ["policy", "PUT", "/api/policy", {}],
      ["suppliers", "POST", "/api/suppliers", {}],
      ["passports", "POST", "/api/passports", {}],
      ["purchaseOrders", "POST", "/api/purchase-orders", {}],
      ["passportRevoke", "POST", "/x", undefined, { id: "pp_A_1" }],
      ["purchaseOrderOverride", "POST", "/x", { decision: "approved", reason: "x" }, { id: "po_x" }],
      ["naiveWebhook", "POST", "/api/webhooks/naive", {}],
    ];
    for (const [name, method, path, body, params] of cases) {
      const r = await call(await routes[name](), method, path, { body, params });
      expect({ name, status: r.status }).toEqual({ name, status: 401 });
      const wrong = await call(await routes[name](), method, path, { body, params, headers: { "x-demo-token": "nope" } });
      expect({ name, status: wrong.status }).toEqual({ name, status: 401 });
    }
    const after = await passport("pp_A_1");
    expect(after.jwt).toBe(before.jwt);
    expect(after.revoked).toBe(false);
  });

  it("the right token is accepted", async () => {
    const r = await tamper({ passportId: "pp_A_1", path: "model", value: "X" }, { "x-demo-token": "qa-secret" });
    expect(r.status).toBe(200);
  });

  it("GET routes and POST /api/verify stay public", async () => {
    expect((await call(await routes.suppliers(), "GET", "/api/suppliers")).status).toBe(200);
    expect((await call(await routes.integrations(), "GET", "/api/integrations/status")).status).toBe(200);
    const v = await call<VerifyResult>(await routes.verify(), "POST", "/api/verify", { body: { jwt: (await passport("pp_A_1")).jwt } });
    expect(v.status).toBe(200);
    expect(v.body.valid).toBe(true);
  });

  it("webhook accepts x-webhook-secret when NAIVE_WEBHOOK_SECRET is set", async () => {
    process.env.NAIVE_WEBHOOK_SECRET = "hook-secret";
    const r = await call(await routes.naiveWebhook(), "POST", "/api/webhooks/naive", {
      body: { providerMessageId: "m1", from: "x@y.z", subject: "s", body: "b", attachments: [] },
      headers: { "x-webhook-secret": "hook-secret" },
    });
    expect(r.status).not.toBe(401);
    const bad = await call(await routes.naiveWebhook(), "POST", "/api/webhooks/naive", {
      body: {},
      headers: { "x-webhook-secret": "wrong" },
    });
    expect(bad.status).toBe(401);
  });
});
