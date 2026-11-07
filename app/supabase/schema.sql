-- Provenant schema for Supabase (Postgres). Mirrors the repository port in src/server/repo/types.ts:
-- one table per collection, each row stores the contract object as jsonb in `data`.
-- `seq` preserves insertion order (agent event timelines rely on it).

create extension if not exists pg_trgm;

do $$
declare t text;
begin
  foreach t in array array[
    'suppliers', 'identity_checks', 'passports', 'evidence_documents', 'buyer_policies',
    'purchase_orders', 'flag_results', 'agent_cases', 'agent_events', 'outbound_messages',
    'inbound_messages', 'status_lists', 'demo_meta'
  ] loop
    execute format(
      'create table if not exists %I (
         id text primary key,
         seq bigserial not null,
         data jsonb not null,
         updated_at timestamptz not null default now()
       )', t);
    execute format('create index if not exists %I on %I (seq)', t || '_seq_idx', t);
    execute format('create index if not exists %I on %I using gin (data jsonb_path_ops)', t || '_data_idx', t);
  end loop;
end $$;

-- Fuzzy supplier-name matching (red flag 7) with pg_trgm.
alter table suppliers
  add column if not exists legal_name text generated always as (data->>'legalName') stored;
create index if not exists suppliers_legal_name_trgm on suppliers using gin (legal_name gin_trgm_ops);

create or replace function similar_suppliers(q text, min_similarity real default 0.5)
returns table (id text, legal_name text, similarity real)
language sql stable as $$
  select s.id, s.legal_name, similarity(s.legal_name, q) as similarity
  from suppliers s
  where similarity(s.legal_name, q) >= min_similarity
  order by similarity desc
  limit 10;
$$;

-- Lookups used by the agent and UI.
create index if not exists passports_supplier_idx on passports ((data->>'supplierId'));
create index if not exists passports_prev_idx on passports ((data->>'prevVersionId'));
create index if not exists agent_events_case_idx on agent_events ((data->>'caseId'), seq);
create index if not exists purchase_orders_supplier_idx on purchase_orders ((data->>'supplierId'));
