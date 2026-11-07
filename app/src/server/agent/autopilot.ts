// Autopilot: advances due cases on its own so nothing needs a click. Two modes (AutopilotStatus.mode):
//
// "interval" (single long-lived Node host): an in-process heartbeat started from src/instrumentation.ts
//   (and lazily by any API call). It sleeps until the next case is due (nextRunAt), at most AGENT_TICK_MS.
//   One timer per process; state lives on globalThis so Next dev HMR never stacks heartbeats.
//
// "request" (serverless, e.g. Vercel: no process between requests): every API request first runs a bounded
//   catch-up (catchUp), and PO creation / demo run keep driving cases for ~20 s via next/server after()
//   (kept alive by the platform's waitUntil), actually waiting AGENT_STEP_DELAY_MS between steps. Since the
//   UI polls every few seconds, cases keep moving while anyone has the app open. The on/off switch is
//   stored in the shared store so every instance agrees.
//
// Pacing in both modes comes from each case's nextRunAt (see machine.ts).
import type { AutopilotStatus } from "@/contracts";
import { env } from "../env";
import { getRepo } from "../repo";
import { DEMO_META_ID } from "../seed/constants";
import { FINAL_STATES, isDue, step, tick } from "./machine";

interface AutopilotState {
  enabled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  lastTickAt: string | null;
}

const g = globalThis as unknown as { __provenantAutopilot?: AutopilotState };

function state(): AutopilotState {
  g.__provenantAutopilot ??= { enabled: env.autopilotDefault(), timer: null, lastTickAt: null };
  return g.__provenantAutopilot;
}

const requestMode = () => env.autopilotMode() === "request";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Request mode: shared on/off flag (default on). AGENT_AUTOPILOT only governs the interval timer. */
async function requestModeEnabled(): Promise<boolean> {
  return (await getRepo().meta.get(DEMO_META_ID))?.autopilotEnabled ?? true;
}

/** ms until the next open case is due (0 if one is due now), or null when no case is open. */
async function msUntilNextDue(): Promise<number | null> {
  const open = (await getRepo().cases.list()).filter((c) => !FINAL_STATES.includes(c.state));
  if (!open.length) return null;
  const now = Date.now();
  return Math.min(...open.map((c) => (isDue(c, now) ? 0 : Date.parse(c.nextRunAt!) - now)));
}

// ---------- interval mode ----------

function schedule(delayMs: number) {
  const s = state();
  if (s.timer || !s.enabled || requestMode()) return;
  s.timer = setTimeout(beat, delayMs);
  // Never keep the process alive just for the heartbeat (tests, scripts, build workers).
  s.timer.unref?.();
}

async function beat() {
  const s = state();
  s.timer = null;
  if (!s.enabled) return;
  let delay = env.tickMs();
  try {
    await tick({ onlyIfDue: true });
    const next = await msUntilNextDue();
    if (next !== null) delay = Math.min(delay, Math.max(20, next));
  } catch (err) {
    console.error("[autopilot] tick failed:", err);
  } finally {
    s.lastTickAt = new Date().toISOString();
  }
  schedule(delay);
}

/** Start the heartbeat if it is enabled and not already scheduled. Cheap; call from any request. */
export function ensureAutopilot(): void {
  // Never run against the store from a `next build` worker; serverless uses request mode instead.
  if (process.env.NEXT_PHASE === "phase-production-build" || requestMode()) return;
  schedule(0);
}

/** Wake the heartbeat now (e.g. right after new cases are created) instead of waiting for the idle interval. */
export function nudgeAutopilot(): void {
  const s = state();
  if (!s.enabled || requestMode()) return;
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  schedule(0);
}

// ---------- request mode ----------

/**
 * Bounded catch-up run at the start of every API request in request mode: step due cases (in parallel)
 * until nothing is due, `budgetMs` elapses or `maxSteps` steps ran. Never throws.
 */
export async function catchUp(budgetMs = 1500, maxSteps = 30): Promise<void> {
  if (!requestMode()) return;
  try {
    if (!(await requestModeEnabled())) return;
    const start = Date.now();
    let steps = 0;
    while (Date.now() - start < budgetMs && steps < maxSteps) {
      const moved = await tick({ onlyIfDue: true });
      state().lastTickAt = new Date().toISOString();
      if (!moved.length) break;
      steps += moved.length;
    }
  } catch (err) {
    console.error("[autopilot] catch-up failed:", err);
  }
}

/** Request mode continuation: keep advancing due cases for up to `ms`, sleeping until the next one is due. */
export async function driveFor(ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      if (!(await requestModeEnabled())) return;
      await tick({ onlyIfDue: true });
      state().lastTickAt = new Date().toISOString();
      const next = await msUntilNextDue();
      if (next === null) return; // every case settled
      await sleep(Math.min(Math.max(50, next), env.tickMs(), Math.max(0, deadline - Date.now())));
    }
  } catch (err) {
    console.error("[autopilot] continuation failed:", err);
  }
}

/** How long after() continuations keep driving cases in request mode. */
export const CONTINUATION_MS = 20_000;

/**
 * Kick freshly opened cases. Interval mode: first step right after the response (after()) plus a heartbeat
 * nudge. Request mode: one after() continuation that drives all due cases for ~20 s.
 * Outside a request scope (tests, scripts) after() is unavailable and only the nudge applies.
 */
export async function kickCases(caseIds: string[]): Promise<void> {
  try {
    const { after } = await import("next/server");
    if (requestMode()) {
      after(() => driveFor(CONTINUATION_MS));
    } else {
      after(async () => {
        for (const id of caseIds) await step(id, { onlyIfDue: true }).catch((err) => console.error("[autopilot] kick failed:", err));
      });
    }
  } catch {
    // not in a request scope
  }
  nudgeAutopilot();
}

export const kickCase = (caseId: string) => kickCases([caseId]);

// ---------- status / toggle ----------

export async function autopilotStatus(): Promise<AutopilotStatus> {
  const s = state();
  const open = (await getRepo().cases.list()).filter((c) => !FINAL_STATES.includes(c.state)).length;
  const enabled = requestMode() ? await requestModeEnabled() : s.enabled;
  return { enabled, mode: env.autopilotMode(), intervalMs: env.tickMs(), lastTickAt: s.lastTickAt, openCases: open };
}

export async function setAutopilot(enabled: boolean): Promise<AutopilotStatus> {
  if (requestMode()) {
    const repo = getRepo();
    const meta = await repo.meta.get(DEMO_META_ID);
    if (meta) await repo.meta.put({ ...meta, autopilotEnabled: enabled });
    return autopilotStatus();
  }
  const s = state();
  s.enabled = enabled;
  if (!enabled && s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  if (enabled) schedule(0);
  return autopilotStatus();
}
