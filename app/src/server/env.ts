// Environment switches (see app/.env.example). Every integration is optional: with no env set the
// app runs fully offline on fixtures, which is also the cached demo mode.
import { accessSync, constants, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { IntegrationStatus } from "@/contracts";
import { LIVE_NAIVE_IMPLEMENTED } from "./naive/live";

const has = (name: string) => Boolean(process.env[name]?.trim());
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name]?.trim() ? v : fallback;
};

export const env = {
  naiveLive: () => has("NAIVE_API_KEY"),
  anthropicLive: () => has("ANTHROPIC_API_KEY"),
  samLive: () => has("SAM_GOV_API_KEY"),
  /** Key-free public lookups (RDAP domain age, CSL JSON download). Off unless LIVE_PUBLIC_LOOKUPS=1. */
  publicLookups: () => process.env.LIVE_PUBLIC_LOOKUPS === "1",
  addressLive: () => has("GOOGLE_MAPS_API_KEY"),
  importYetiLive: () => has("IMPORTYETI_API_KEY"),
  supabase: () => has("SUPABASE_URL") && (has("SUPABASE_SERVICE_ROLE_KEY") || has("SUPABASE_ANON_KEY")),
  /** Upstash Redis REST credentials (Vercel KV integration names or Upstash's own). */
  redis: (): { url: string; token: string } | null => {
    const url = process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    return url && token ? { url, token } : null;
  },
  /** Serverless host (no long-lived process, read-only FS except the temp dir). */
  serverless: () => Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY),
  /** Persist the in-memory store and generated keys under DATA_DIR (off under vitest unless forced). */
  persist: () =>
    process.env.PROVENANT_PERSIST === "1" || (process.env.PROVENANT_PERSIST !== "0" && !process.env.VITEST),
  /** Writable directory for db.json / keys.json, or null when nothing is writable (memory only). */
  dataDir: (): string | null => resolveDataDir(),
  /** "interval": in-process heartbeat (single Node host). "request": serverless, cases advance on API requests. */
  autopilotMode: (): "interval" | "request" => (env.serverless() ? "request" : "interval"),
  /** Server heartbeat that advances cases with no clicks. Default on (off under vitest). */
  autopilotDefault: () =>
    process.env.AGENT_AUTOPILOT ? process.env.AGENT_AUTOPILOT !== "0" : !process.env.VITEST,
  /** Idle heartbeat interval. */
  tickMs: () => Math.max(50, num("AGENT_TICK_MS", 1500)),
  /** Delay between agent steps while cases are active, so the UI timeline visibly animates. */
  stepDelayMs: () => Math.max(0, num("AGENT_STEP_DELAY_MS", 900)),
  /** When set, demo-mutating routes require header x-demo-token to match (public deploys). */
  demoAdminToken: () => process.env.DEMO_ADMIN_TOKEN?.trim() || null,
  publicBaseUrl: () => process.env.PUBLIC_BASE_URL || "https://provenant.local",
};

const g = globalThis as unknown as { __provenantDataDir?: string | null; __provenantWarned?: Set<string> };

/** Log a persistence problem once per process, then carry on in memory. */
export function warnOnce(key: string, message: string, err?: unknown) {
  g.__provenantWarned ??= new Set();
  if (g.__provenantWarned.has(key)) return;
  g.__provenantWarned.add(key);
  console.warn(`[provenant] ${message}`, err instanceof Error ? err.message : (err ?? ""));
}

function writable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * DATA_DIR (default ".data"; on serverless default <tmpdir>/provenant), falling back to the temp dir and
 * finally to memory-only when nothing is writable. Resolved once per process.
 */
function resolveDataDir(): string | null {
  if (g.__provenantDataDir !== undefined) return g.__provenantDataDir;
  const configured = process.env.PROVENANT_DATA_DIR?.trim() || process.env.DATA_DIR?.trim();
  const tmp = join(tmpdir(), "provenant");
  const first = configured ? (isAbsolute(configured) ? configured : join(process.cwd(), configured)) : env.serverless() ? tmp : join(process.cwd(), ".data");
  let dir: string | null = null;
  for (const candidate of [first, tmp]) {
    if (writable(candidate)) {
      dir = candidate;
      break;
    }
  }
  if (dir !== first) warnOnce("data-dir", `data dir ${first} is not writable; using ${dir ?? "memory only (no persistence)"}`);
  g.__provenantDataDir = dir;
  return dir;
}

export function integrationStatus(
  checkSources: IntegrationStatus["checkSources"],
  signingKeys: IntegrationStatus["signingKeys"],
): IntegrationStatus {
  return {
    naive: env.naiveLive() ? (LIVE_NAIVE_IMPLEMENTED ? "live" : "live_pending") : "stub",
    anthropic: env.anthropicLive() ? "live" : "fixture",
    samGov: env.samLive() ? "live" : "fixture",
    storage: env.supabase() ? "supabase" : env.redis() ? "redis" : "memory",
    signingKeys,
    // Read per request (Docker builds don't carry runtime env); null -> client falls back to window.location.origin.
    publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim() || null,
    checkSources,
  };
}
