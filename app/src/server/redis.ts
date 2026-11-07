// Upstash Redis (REST) client, used only when KV_REST_API_* / UPSTASH_REDIS_REST_* are set. The fixture /
// offline path never constructs it. A narrow interface keeps the shared store and locks testable with an
// in-process fake.
import { Redis } from "@upstash/redis";
import { env } from "./env";

export interface RedisLike {
  get(key: string): Promise<string | null>;
  /** SET with optional NX / PX. Resolves "OK" when written, null when NX blocked it. */
  set(key: string, value: string, opts?: { nx?: boolean; px?: number }): Promise<"OK" | null>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const g = globalThis as unknown as { __provenantRedis?: RedisLike | null; __provenantRedisOverride?: RedisLike | null };

function wrap(client: Redis): RedisLike {
  return {
    get: async (key) => {
      const v = await client.get<string>(key);
      return v === null || v === undefined ? null : String(v);
    },
    set: async (key, value, opts) => {
      const r = opts?.nx
        ? await client.set(key, value, opts.px ? { nx: true, px: opts.px } : { nx: true })
        : await client.set(key, value, opts?.px ? { px: opts.px } : undefined);
      return r === "OK" ? "OK" : null;
    },
    eval: (script, keys, args) => client.eval(script, keys, args),
  };
}

export function getRedis(): RedisLike | null {
  if (g.__provenantRedisOverride !== undefined) return g.__provenantRedisOverride;
  if (g.__provenantRedis === undefined) {
    const cfg = env.redis();
    g.__provenantRedis = cfg ? wrap(new Redis({ url: cfg.url, token: cfg.token, automaticDeserialization: false })) : null;
  }
  return g.__provenantRedis;
}

/** Test hook: inject a fake (or null to force "no Redis"); undefined restores env-based behaviour. */
export function setRedisForTests(client: RedisLike | null | undefined) {
  g.__provenantRedisOverride = client;
}

export const redisKey = (name: string) => `${process.env.REDIS_KEY_PREFIX?.trim() || "provenant"}:${name}`;
