// In-memory repository, persisted to app/.data/db.json so state survives dev-server restarts.
// The instance lives on globalThis (see repo/index.ts) so it also survives Next dev HMR.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { COLLECTIONS, type Collection, type CollectionName, type Entity, type Repo } from "./types";

type Tables = Record<CollectionName, Map<string, Entity>>;

const clone = <T>(v: T): T => structuredClone(v);

function matches<T extends Entity>(item: T, where?: Partial<T>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => (item as Record<string, unknown>)[k] === v);
}

export class MemoryRepo implements Repo {
  readonly kind = "memory" as const;
  private tables: Tables;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string | null) {
    this.tables = MemoryRepo.emptyTables();
    if (file && existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Record<CollectionName, Entity[]>>;
        for (const name of COLLECTIONS) {
          for (const row of raw[name] ?? []) this.tables[name].set(row.id, row);
        }
      } catch (err) {
        console.warn(`[repo] ignoring unreadable ${file}:`, err);
      }
    }
  }

  private static emptyTables(): Tables {
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
        this.schedulePersist();
        return clone(item);
      },
      delete: async (id) => {
        table().delete(id);
        this.schedulePersist();
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
    this.schedulePersist();
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

  flush() {
    if (!this.file) return;
    const out = Object.fromEntries(COLLECTIONS.map((n) => [n, [...this.tables[n].values()]]));
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(out));
    renameSync(tmp, this.file);
  }
}
