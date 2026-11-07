"use client";

import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { DataSource, FlagId, FlagResult, IdentityCheckKind } from "@/contracts";
import { ALL_FLAGS, FLAG_CHECK_INPUTS, FLAG_META, IDENTITY_CHECK_LABEL, flagLabel } from "@/lib/domain-meta";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { EvidenceView } from "@/components/evidence-view";
import { CheckStatusBadge, CheckStatusIcon, RunModeBadge } from "@/components/status";

type SkipKind = "not_required" | "no_data";

function skipReason(result: FlagResult): string | null {
  const r = result.evidence?.reason;
  return typeof r === "string" ? r : null;
}

function FlagCard({
  id,
  result,
  skipKind,
  checkSources,
}: {
  id: FlagId;
  result?: FlagResult;
  skipKind?: SkipKind;
  checkSources?: Partial<Record<IdentityCheckKind, DataSource>>;
}) {
  const meta = FLAG_META[id];
  const notRequired = !result && skipKind === "not_required";
  const [open, setOpen] = useState(result?.status === "flag");
  const status = result?.status;
  const mode = result?.mode ?? meta.hackathonMode;
  const inputs = (FLAG_CHECK_INPUTS[id] ?? []).map((k) => checkSources?.[k]).filter(Boolean);
  const dataLabel = inputs.length === 0 ? null : inputs.every((s) => s === "live") ? "live data" : inputs.some((s) => s === "live") ? "mixed data" : "fixture data";
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-card p-3 transition-colors",
        status === "flag" && "border-blocked/35 bg-blocked/[0.035] shadow-[inset_3px_0_0_var(--blocked)]",
        status === "skip" && "bg-muted/30",
        !result && !notRequired && "border-dashed",
        notRequired && "bg-muted/40 opacity-70",
      )}
    >
      <div className="flex items-start gap-2">
        {result ? <CheckStatusIcon status={result.status} className="mt-0.5" /> : <span className="mt-0.5 size-4 rounded-full border border-dashed" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] font-semibold text-muted-foreground">{flagLabel(id)}</span>
            <RunModeBadge mode={mode} />
            {result && <CheckStatusBadge status={result.status} />}
          </div>
          {dataLabel && (
            <div className="mt-1 text-[10.5px] text-muted-foreground" title="Logic mode · where its inputs came from">
              {mode} logic · <span className={dataLabel === "live data" ? "text-approved" : "text-[color-mix(in_oklch,var(--quarantined),black_25%)]"}>{dataLabel}</span>
            </div>
          )}
          <div className={cn("mt-1 text-[13px] leading-snug font-medium", status === "skip" && "text-muted-foreground")}>{meta.title}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{meta.method}</div>
        </div>
      </div>
      {result ? (
        <>
          {status === "skip" && (
            <div
              className={cn(
                "mt-2 inline-flex self-start rounded border px-1.5 text-[10.5px] font-medium",
                skipKind === "not_required" ? "text-muted-foreground" : "border-quarantined/40 text-[color-mix(in_oklch,var(--quarantined),black_25%)]",
              )}
            >
              {skipKind === "not_required" ? "Not required for this tier" : "Skipped — no data"}
            </div>
          )}
          <p className={cn("mt-2 text-xs leading-relaxed", status === "flag" ? "text-foreground" : "text-muted-foreground")}>
            {result.explanation}
          </p>
          {status === "skip" && skipReason(result) && skipReason(result) !== result.explanation && (
            <p className="mt-1 text-[11px] text-muted-foreground">Reason: {skipReason(result)}</p>
          )}
          {Object.keys(result.evidence ?? {}).length > 0 && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="mt-2 inline-flex items-center gap-0.5 self-start text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
              Evidence
            </button>
          )}
          {open && <EvidenceView data={result.evidence} className="mt-1.5 grid-cols-1 gap-y-0.5 rounded-md border bg-background p-2 [&_dd]:mb-1 [&_dd]:[overflow-wrap:anywhere]" />}
        </>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {notRequired
            ? "Not required for this tier: the buyer policy does not evaluate this flag at this risk tier."
            : "Not evaluated yet. The agent runs this in the evaluating step."}
        </p>
      )}
    </div>
  );
}

/** Where flag inputs come from right now. "Live" logic can still run on fixture data. */
function DataSources() {
  const q = useApi("integrations", () => api.integrationStatus(), 30_000);
  if (!q.data) return null;
  const items: { label: string; live: boolean; value: string }[] = [
    { label: "SAM.gov registry", live: q.data.samGov === "live", value: q.data.samGov },
    { label: "Claude extraction", live: q.data.anthropic === "live", value: q.data.anthropic },
    { label: "Supplier email (Naive)", live: q.data.naive === "live", value: q.data.naive === "live_pending" ? "stub (key detected)" : q.data.naive },
    { label: "Storage", live: q.data.storage === "supabase", value: q.data.storage },
    ...(Object.entries(q.data.checkSources ?? {}) as [IdentityCheckKind, DataSource][]).map(([k, src]) => ({
      label: IDENTITY_CHECK_LABEL[k]?.source ?? k,
      live: src === "live",
      value: src,
    })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed px-2.5 py-1.5 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground/80">Data sources:</span>
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <span className={cn("size-1.5 rounded-full", i.live ? "bg-approved" : "bg-quarantined")} />
          {i.label} <span className="font-mono">{i.value}</span>
        </span>
      ))}
      <span>Fixture means real rules run on prepared responses, not live third-party calls.</span>
    </div>
  );
}

/** The 10 red flags from the spec, with result, run mode (live/seeded/simulated) and explanation. */
export function FlagGrid({ flags, requiredFlags }: { flags: FlagResult[]; requiredFlags?: FlagId[] }) {
  const byId = new Map(flags.map((f) => [f.flag, f]));
  const integrations = useApi("integrations", () => api.integrationStatus(), 30_000);
  // A skip on a flag the tier requires means the rule had nothing to run on (e.g. no NFC tag, no prior
  // passport version). Only flags outside the tier's list are "not required".
  const skipKindOf = (id: FlagId): SkipKind => (requiredFlags && !requiredFlags.includes(id) ? "not_required" : "no_data");
  const raised = flags.filter((f) => f.status === "flag").length;
  const passed = flags.filter((f) => f.status === "pass").length;
  // Flags outside the tier are never evaluated, so they don't appear in `flags`; count them from policy.
  const notRequired = requiredFlags
    ? ALL_FLAGS.filter((id) => !requiredFlags.includes(id)).length
    : flags.filter((f) => f.status === "skip" && skipKindOf(f.flag) === "not_required").length;
  const noData = flags.filter((f) => f.status === "skip" && skipKindOf(f.flag) === "no_data").length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-blocked tabular">{raised}</span> raised
        </span>
        <span>
          <span className="font-semibold text-approved tabular">{passed}</span> passed
        </span>
        {noData > 0 && (
          <span>
            <span className="font-semibold text-[color-mix(in_oklch,var(--quarantined),black_25%)] tabular">{noData}</span> skipped (no data)
          </span>
        )}
        <span>
          <span className="font-semibold tabular">{notRequired}</span> not required for tier
        </span>
        {flags.length === 0 && <span>· not evaluated yet</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <RunModeBadge mode="live" /> real logic
          <RunModeBadge mode="seeded" className="ml-2" /> real logic, prepared data
          <RunModeBadge mode="simulated" className="ml-2" /> UI only
        </span>
      </div>
      <DataSources />
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {[...ALL_FLAGS]
          .sort((a, b) => {
            const rank = (id: FlagId) =>
              byId.get(id)?.status === "flag" ? 0 : !byId.get(id) && skipKindOf(id) === "not_required" ? 2 : 1;
            return rank(a) - rank(b) || FLAG_META[a].num - FLAG_META[b].num;
          })
          .map((id) => (
            <FlagCard
              key={`${id}:${byId.get(id)?.status ?? "none"}`}
              id={id}
              result={byId.get(id)}
              skipKind={skipKindOf(id)}
              checkSources={integrations.data?.checkSources}
            />
          ))}
      </div>
    </div>
  );
}
