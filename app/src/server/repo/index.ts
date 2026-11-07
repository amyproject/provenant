// Repository factory. One instance per server process, held on globalThis so it survives Next dev HMR.
import { env } from "../env";
import { getRedis } from "../redis";
import { MemoryRepo } from "./memory";
import { RedisRepo } from "./redis";
import { SupabaseRepo } from "./supabase";
import type { Repo } from "./types";

export type { Repo } from "./types";
export * from "./types";
export { RedisRepo } from "./redis";

const g = globalThis as unknown as { __provenantRepo?: Repo };

export function getRepo(): Repo {
  if (!g.__provenantRepo) {
    if (env.supabase()) {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
      g.__provenantRepo = new SupabaseRepo(process.env.SUPABASE_URL!, key);
    } else if (getRedis()) {
      g.__provenantRepo = new RedisRepo(getRedis()!);
    } else {
      const dir = env.persist() ? env.dataDir() : null;
      g.__provenantRepo = new MemoryRepo(dir ? `${dir}/db.json` : null);
    }
  }
  return g.__provenantRepo;
}

/** Test hook: drop the singleton so the next getRepo() builds a fresh store. */
export function resetRepoSingleton() {
  g.__provenantRepo = undefined;
}
