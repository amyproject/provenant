// In-memory repository, persisted to app/.data/db.json so state survives dev-server restarts.
// The instance lives on globalThis (see repo/index.ts) so it also survives Next dev HMR.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { warnOnce } from "../env";
import { COLLECTIONS, type Collection, type CollectionName, type Entity, type Repo } from "./types";

export type Tables = Record<CollectionName, Map<string, Entity>>;
/** One store mutation (replayed by RedisRepo on top of a newer remote document). */
export type Mutation = { op: "put"; table: CollectionName; item: Entity } | { op: "delete"; table: CollectionName; id: string } | { op: "clear" };

const clone = <T>(v: T): T => structuredClone(v);

function matches<T extends Entity>(item: T, where?: Partial<T>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => (item as Record<string, unknown>)[k] === v);
}

export class MemoryRepo implements Repo {
  readonly kind: Repo["kind"] = "memory";
  protected tables: Tables;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private file: string | null) {
    this.tables = MemoryRepo.emptyTables();
    if (file && existsSync(file)) {
      try {
        this.load(JSON.parse(readFileSync(file, "utf8")) as Partial<Record<CollectionName, Entity[]>>);
      } catch (err) {
        warnOnce("db-read", `ignoring unreadable ${file}:`, err);
      }
    }
  }

  protected static emptyTables(): Tables {
    return Object.fromEntries(COLLECTIONS.map((n) => [n, new Map()])) as Tables;
  }

  private collection<T extends Entity>(name: CollectionName): Collection<T> {
    const table = () => this.tables[name] as Map<string, T>;
    return {
      get: async (id) => {
        const v = table().get(id);
        return v ? clone(v) : null;
      },
      list: async (where) => [...table().values()].filter((v) => matches(v, where)).map(clone),
      put: async (item) => {
        table().set(item.id, clone(item));
        this.onMutation({ op: "put", table: name, item: clone(item) });
        return clone(item);
      },
      delete: async (id) => {
        table().delete(id);
        this.onMutation({ op: "delete", table: name, id });
      },
    };
  }

  suppliers: Repo["suppliers"] = this.collection("suppliers");
  identityChecks: Repo["identityChecks"] = this.collection("identityChecks");
  passports: Repo["passports"] = this.collection("passports");
  documents: Repo["documents"] = this.collection("documents");
  policies: Repo["policies"] = this.collection("policies");
  purchaseOrders: Repo["purchaseOrders"] = this.collection("purchaseOrders");
  flagResults: Repo["flagResults"] = this.collection("flagResults");
  cases: Repo["cases"] = this.collection("cases");
  events: Repo["events"] = this.collection("events");
  outbox: Repo["outbox"] = this.collection("outbox");
  inbox: Repo["inbox"] = this.collection("inbox");
  statusLists: Repo["statusLists"] = this.collection("statusLists");
  meta: Repo["meta"] = this.collection("meta");

  async clear(): Promise<void> {
    this.tables = MemoryRepo.emptyTables();
    this.onMutation({ op: "clear" });
  }

  /** Called after every local mutation. Memory: schedule a file write. Redis: queue for commit. */
  protected onMutation(m: Mutation): void {
    void m;
    this.schedulePersist();
  }

  /** Apply a mutation to the in-memory tables (used for replay). */
  protected apply(m: Mutation): void {
    if (m.op === "clear") this.tables = MemoryRepo.emptyTables();
    else if (m.op === "put") this.tables[m.table].set(m.item.id, clone(m.item));
    else this.tables[m.table].delete(m.id);
  }

  protected serialize(): string {
    return JSON.stringify(Object.fromEntries(COLLECTIONS.map((n) => [n, [...this.tables[n].values()]])));
  }

  protected load(raw: Partial<Record<CollectionName, Entity[]>>): void {
    this.tables = MemoryRepo.emptyTables();
    for (const name of COLLECTIONS) for (const row of raw[name] ?? []) this.tables[name].set(row.id, row);
  }

  isEmpty(): boolean {
    return this.tables.meta.size === 0;
  }

  /** Coalesce bursts of writes (an agent run appends many events) into one file write. */
  private schedulePersist() {
    if (!this.file || this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush();
    }, 25);
  }

  /** Write db.json. Never throws: on failure (read-only FS) log once and continue in memory only. */
  flush() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, this.serialize());
      renameSync(tmp, this.file);
    } catch (err) {
      warnOnce("db-write", `could not persist ${this.file}; continuing in memory only:`, err);
      this.file = null;
    }
  }
}
