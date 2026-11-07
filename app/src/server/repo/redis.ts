// Shared store for serverless (Upstash Redis). Demo scale, so the whole store is ONE JSON document plus a
// version counter:
//   - sync():   GET version; if it moved, GET the document and replay still-pending local mutations on top.
//   - commit(): Lua check-and-set (write only if the version is unchanged); on conflict reload, replay, retry.
// Reads/writes in between hit the in-memory tables inherited from MemoryRepo. Agent steps additionally
// take a per-case lock (withCaseLock) so two instances never advance the same case at once.
import { randomBytes } from "node:crypto";
import type { RedisLike } from "../redis";
import { redisKey } from "../redis";
import { MemoryRepo, type Mutation } from "./memory";
import type { CollectionName, Entity } from "./types";

const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if (cur or '0') ~= ARGV[1] then return -1 end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SET', KEYS[1], ARGV[3])
return tonumber(ARGV[3])`;

const UNLOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

interface StoredDoc {
  version: number;
  tables: Partial<Record<CollectionName, Entity[]>>;
}

export class RedisRepo extends MemoryRepo {
  override readonly kind = "redis" as const;
  private version = 0;
  private pending: Mutation[] = [];
  private replaying = false;
  private committing: Promise<void> = Promise.resolve();

  constructor(private readonly redis: RedisLike) {
    super(null);
  }

  private get versionKey() {
    return redisKey("store:version");
  }
  private get docKey() {
    return redisKey("store:doc");
  }

  protected override onMutation(m: Mutation): void {
    if (!this.replaying) this.pending.push(m);
  }

  private replay(ops: Mutation[]) {
    this.replaying = true;
    try {
      for (const m of ops) this.apply(m);
    } finally {
      this.replaying = false;
    }
  }

  private async reload(): Promise<void> {
    const raw = await this.redis.get(this.docKey);
    const doc: StoredDoc = raw ? (JSON.parse(raw) as StoredDoc) : { version: 0, tables: {} };
    this.load(doc.tables);
    this.version = doc.version;
    this.replay(this.pending);
  }

  async sync(): Promise<void> {
    const remote = Number((await this.redis.get(this.versionKey)) ?? 0);
    if (remote !== this.version) await this.reload();
  }

  /** Serialized per instance; retries optimistic-concurrency conflicts by reloading and replaying. */
  commit(): Promise<void> {
    const run = this.committing.then(() => this.commitNow());
    this.committing = run.catch(() => undefined);
    return run;
  }

  private async commitNow(): Promise<void> {
    if (!this.pending.length) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const ops = this.pending.length;
      const next = this.version + 1;
      const body = JSON.stringify({ version: next, tables: JSON.parse(this.serialize()) } satisfies StoredDoc);
      const r = Number(await this.redis.eval(CAS_SCRIPT, [this.versionKey, this.docKey], [String(this.version), body, String(next)]));
      if (r === next) {
        this.version = next;
        this.pending.splice(0, ops); // mutations made while awaiting stay pending for the next commit
        return;
      }
      await this.reload(); // someone else committed first: take theirs, replay ours, try again
    }
    throw new Error("shared store: too many concurrent write conflicts, try again");
  }

  /**
   * Run `fn` holding a short per-case lock (SET NX PX). Resolves to null without running `fn` when
   * another instance holds it, so the caller can treat the step as a no-op.
   */
  async withCaseLock<T>(caseId: string, fn: () => Promise<T>, ttlMs = 15_000): Promise<T | null> {
    const key = redisKey(`lock:case:${caseId}`);
    const token = randomBytes(12).toString("hex");
    if ((await this.redis.set(key, token, { nx: true, px: ttlMs })) !== "OK") return null;
    try {
      return await fn();
    } finally {
      await this.redis.eval(UNLOCK_SCRIPT, [key], [token]).catch(() => undefined);
    }
  }
}
