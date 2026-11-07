// Server-side autopilot: a heartbeat that advances due cases on its own so nothing needs a click.
// Started from src/instrumentation.ts at server boot (and lazily by any API call). Pacing comes from
// each case's nextRunAt (AGENT_STEP_DELAY_MS between working steps, AGENT_TICK_MS while waiting); the
// heartbeat sleeps until the next case is due, at most AGENT_TICK_MS. One timer per process: state
// lives on globalThis so Next dev HMR never stacks heartbeats.
import type { AutopilotStatus } from "@/contracts";
import { env } from "../env";
import { getRepo } from "../repo";
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

function schedule(delayMs: number) {
  const s = state();
  if (s.timer || !s.enabled) return;
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
    const open = (await getRepo().cases.list()).filter((c) => !FINAL_STATES.includes(c.state));
    const now = Date.now();
    for (const c of open) {
      const wait = isDue(c, now) ? 0 : Date.parse(c.nextRunAt!) - now;
      delay = Math.min(delay, Math.max(20, wait));
    }
  } catch (err) {
    console.error("[autopilot] tick failed:", err);
  } finally {
    s.lastTickAt = new Date().toISOString();
  }
  schedule(delay);
}

/** Start the heartbeat if it is enabled and not already scheduled. Cheap; call from any request. */
export function ensureAutopilot(): void {
  // Never run against the store from a `next build` worker.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  schedule(0);
}

/** Wake the heartbeat now (e.g. right after new cases are created) instead of waiting for the idle interval. */
export function nudgeAutopilot(): void {
  const s = state();
  if (!s.enabled) return;
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  schedule(0);
}

export async function autopilotStatus(): Promise<AutopilotStatus> {
  const s = state();
  const open = (await getRepo().cases.list()).filter((c) => !FINAL_STATES.includes(c.state)).length;
  return { enabled: s.enabled, intervalMs: env.tickMs(), lastTickAt: s.lastTickAt, openCases: open };
}

export async function setAutopilot(enabled: boolean): Promise<AutopilotStatus> {
  const s = state();
  s.enabled = enabled;
  if (!enabled && s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  if (enabled) schedule(0);
  return autopilotStatus();
}

/**
 * Kick a freshly opened case: run its first step right after the response is sent (next/server
 * `after()`), then wake the heartbeat. Outside a request scope (tests, scripts) only the nudge applies.
 */
export async function kickCase(caseId: string): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(async () => {
      await step(caseId, { onlyIfDue: true }).catch((err) => console.error("[autopilot] kick failed:", err));
    });
  } catch {
    // not in a request scope
  }
  nudgeAutopilot();
}
