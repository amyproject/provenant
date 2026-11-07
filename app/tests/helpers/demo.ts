// Drives the demo the way production does: /demo/run returns immediately, then the autopilot
// heartbeat (POST /api/agent/tick) advances cases. No per-case step/run calls.
import { expect } from "vitest";
import type { AgentCase, AgentTickResponse, DemoRunResponse, PurchaseOrderDetail } from "@/contracts";
import { call } from "./route";
import { routes } from "./routes";

export const RESTING = ["closed", "monitoring", "escalated"] as const;
export const isResting = (c: AgentCase | null | undefined) => !!c && (RESTING as readonly string[]).includes(c.state);

export async function stopAutopilot() {
  try {
    await call(await routes.agentAutopilot(), "POST", "/api/agent/autopilot", { body: { enabled: false } });
  } catch {
    // route may not exist yet; tests that need it will fail on their own
  }
}

export async function resetDemo() {
  const r = await call(await routes.demoReset(), "POST", "/api/demo/reset");
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ ok: true });
}

export async function startDemo(): Promise<DemoRunResponse> {
  const r = await call<DemoRunResponse>(await routes.demoRun(), "POST", "/api/demo/run");
  expect(r.status).toBe(200);
  return r.body;
}

export async function getPo(id: string): Promise<PurchaseOrderDetail> {
  const d = await call<PurchaseOrderDetail>(await routes.purchaseOrder(), "GET", `/api/purchase-orders/${id}`, {
    params: { id },
  });
  expect(d.status).toBe(200);
  return d.body;
}

export async function listCases(): Promise<AgentCase[]> {
  const r = await call<AgentCase[]>(await routes.agentCases(), "GET", "/api/agent/cases");
  expect(r.status).toBe(200);
  return r.body;
}

/** Tick the heartbeat until every given case rests. Returns tick count. */
export async function tickUntilResting(caseIds: string[], maxTicks = 200): Promise<number> {
  const tick = await routes.agentTick();
  for (let i = 1; i <= maxTicks; i++) {
    const r = await call<AgentTickResponse>(tick, "POST", "/api/agent/tick");
    expect(r.status).toBe(200);
    const cases = await listCases();
    if (caseIds.every((id) => isResting(cases.find((c) => c.id === id)))) return i;
  }
  const cases = await listCases();
  throw new Error(
    `cases did not rest after ${maxTicks} ticks: ${JSON.stringify(cases.filter((c) => caseIds.includes(c.id)).map((c) => [c.id, c.state, c.nextRunAt]))}`,
  );
}

/** reset -> run -> tick to completion. */
export async function runDemoToCompletion() {
  await stopAutopilot();
  await resetDemo();
  const run = await startDemo();
  const ticks = await tickUntilResting(run.results.map((r) => r.caseId));
  return { run, ticks };
}
