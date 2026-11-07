// Supabase implementation of the repository port. Used only when SUPABASE_URL + a key are set.
// Each collection is a table (id text pk, seq bigserial, data jsonb) — see supabase/schema.sql.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { COLLECTIONS, type Collection, type CollectionName, type Entity, type Repo } from "./types";

const TABLE: Record<CollectionName, string> = {
  suppliers: "suppliers",
  identityChecks: "identity_checks",
  passports: "passports",
  documents: "evidence_documents",
  policies: "buyer_policies",
  purchaseOrders: "purchase_orders",
  flagResults: "flag_results",
  cases: "agent_cases",
  events: "agent_events",
  outbox: "outbound_messages",
  inbox: "inbound_messages",
  statusLists: "status_lists",
  meta: "demo_meta",
};

export class SupabaseRepo implements Repo {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, key: string) {
    this.db = createClient(url, key, { auth: { persistSession: false } });
  }

  private collection<T extends Entity>(name: CollectionName): Collection<T> {
    const table = TABLE[name];
    const fail = (op: string, err: { message: string }) => {
      throw new Error(`[supabase] ${op} ${table}: ${err.message}`);
    };
    return {
      get: async (id) => {
        const { data, error } = await this.db.from(table).select("data").eq("id", id).maybeSingle();
        if (error) fail("get", error);
        return (data?.data as T | undefined) ?? null;
      },
      list: async (where) => {
        let q = this.db.from(table).select("data").order("seq", { ascending: true });
        if (where && Object.keys(where).length) q = q.contains("data", where);
        const { data, error } = await q;
        if (error) fail("list", error);
        return (data ?? []).map((r) => r.data as T);
      },
      put: async (item) => {
        const { error } = await this.db.from(table).upsert({ id: item.id, data: item }, { onConflict: "id" });
        if (error) fail("put", error);
        return item;
      },
      delete: async (id) => {
        const { error } = await this.db.from(table).delete().eq("id", id);
        if (error) fail("delete", error);
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
    for (const name of COLLECTIONS) {
      const { error } = await this.db.from(TABLE[name]).delete().neq("id", "");
      if (error) throw new Error(`[supabase] clear ${TABLE[name]}: ${error.message}`);
    }
  }
}

export const SUPABASE_TABLES = TABLE;
