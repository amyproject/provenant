// Environment switches (see app/.env.example). Every integration is optional: with no env set the
// app runs fully offline on fixtures, which is also the cached demo mode.
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
  /** Persist the in-memory store and generated keys under DATA_DIR (off under vitest unless forced). */
  persist: () =>
    process.env.PROVENANT_PERSIST === "1" || (process.env.PROVENANT_PERSIST !== "0" && !process.env.VITEST),
  dataDir: () => {
    const dir = process.env.PROVENANT_DATA_DIR?.trim() || process.env.DATA_DIR?.trim() || ".data";
    return dir.startsWith("/") ? dir : `${process.cwd()}/${dir}`;
  },
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

export function integrationStatus(checkSources: IntegrationStatus["checkSources"]): IntegrationStatus {
  return {
    naive: env.naiveLive() ? (LIVE_NAIVE_IMPLEMENTED ? "live" : "live_pending") : "stub",
    anthropic: env.anthropicLive() ? "live" : "fixture",
    samGov: env.samLive() ? "live" : "fixture",
    storage: env.supabase() ? "supabase" : "memory",
    // Read per request (Docker builds don't carry runtime env); null -> client falls back to window.location.origin.
    publicBaseUrl: process.env.PUBLIC_BASE_URL?.trim() || null,
    checkSources,
  };
}
