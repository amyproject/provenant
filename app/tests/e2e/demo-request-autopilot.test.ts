// Serverless (Vercel) mode: no in-process timer; the agent advances only because API requests arrive.
// Drives the whole demo with nothing but repeated GETs, the way the polling UI does.
process.env.VERCEL = "1";
process.env.AGENT_AUTOPILOT = "0";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO, type AutopilotStatus, type DemoRunResponse, type PurchaseOrderDetail } from "@/contracts";
import { call, trapFetch } from "../helpers/route";
import { routes } from "../helpers/routes";

let net: ReturnType<typeof trapFetch>;
let run: DemoRunResponse;
let gets = 0;
let final: PurchaseOrderDetail[] = [];

beforeAll(async () => {
  process.env.VERCEL = "1";
  process.env.AGENT_AUTOPILOT = "0";
  net = trapFetch();
  expect((await call(await routes.demoReset(), "POST", "/api/demo/reset")).status).toBe(200);
  const r = await call<DemoRunResponse>(await routes.demoRun(), "POST", "/api/demo/run");
  expect(r.status).toBe(200);
  run = r.body;
  const list = await routes.purchaseOrders();
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    final = (await call<PurchaseOrderDetail[]>(list, "GET", "/api/purchase-orders")).body;
    gets++;
    if (final.length === 3 && final.every((d) => ["closed", "monitoring"].includes(d.agentCase?.state ?? ""))) break;
    await new Promise((res) => setTimeout(res, 50));
  }
});

afterAll(() => {
  net?.restore();
  delete process.env.VERCEL;
  delete process.env.AGENT_AUTOPILOT;
});

describe("request-driven autopilot (VERCEL=1, AGENT_AUTOPILOT=0)", () => {
  it("AutopilotStatus.mode is request", async () => {
    const s = await call<AutopilotStatus>(await routes.agentAutopilot(), "GET", "/api/agent/autopilot");
    expect(s.status).toBe(200);
    expect(s.body.mode).toBe("request");
  });

  it("GET polling alone drives A approved, B quarantined, C blocked", () => {
    expect(gets).toBeGreaterThan(1);
    for (const r of run.results) {
      const d = final.find((x) => x.purchaseOrder.id === r.purchaseOrderId)!;
      expect({ l: r.supplierLabel, d: d.purchaseOrder.decision }).toEqual({ l: r.supplierLabel, d: DEMO[r.supplierLabel].expected });
    }
  });

  it("made no outbound network calls", () => {
    expect(net.calls).toEqual([]);
  });
});
