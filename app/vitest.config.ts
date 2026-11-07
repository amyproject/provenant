import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// QA-owned. Run with: cd app && npx vitest run
// Tests never touch app/.data: keys and any persisted state go to a throwaway temp dir.
const dataDir = mkdtempSync(join(tmpdir(), "provenant-qa-"));

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Fixture mode: tests must never depend on live keys or public lookups.
    env: {
      DATA_DIR: dataDir,
      PROVENANT_DATA_DIR: dataDir,
      AGENT_STEP_DELAY_MS: "0",
      NAIVE_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      SAM_GOV_API_KEY: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SIGNING_PRIVATE_JWK: "",
    },
    // Repo + key files are module singletons; isolate per file and run files serially.
    pool: "forks",
    fileParallelism: false,
  },
});
