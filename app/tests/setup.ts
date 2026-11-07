// Runs before every test file. Empty-string env keys can read as "set" in sloppy checks, so delete them.
for (const k of [
  "NAIVE_API_KEY",
  "ANTHROPIC_API_KEY",
  "SAM_GOV_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SIGNING_PRIVATE_JWK",
  "LIVE_PUBLIC_LOOKUPS",
  "SUPABASE_ANON_KEY",
  "CSL_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "IMPORTYETI_API_KEY",
  "RDAP_LIVE",
  "AGENT_AUTOPILOT_MS",
  "PROVENANT_PERSIST",
  "PUBLIC_BASE_URL",
  "DEMO_ADMIN_TOKEN",
  "AGENT_AUTOPILOT",
  "AGENT_TICK_MS",
]) {
  delete process.env[k];
}
process.env.AGENT_STEP_DELAY_MS = "0";
for (const k of ["DATA_DIR", "PROVENANT_DATA_DIR"]) {
  if (!process.env[k] || process.env[k]!.includes("/app/.data")) throw new Error(`QA setup: ${k} must point at a temp dir`);
}
