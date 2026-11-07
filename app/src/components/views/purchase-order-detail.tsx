"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertOctagonIcon,
  ArrowRightIcon,
  BotIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  ClockIcon,
  FastForwardIcon,
  KeyRoundIcon,
  MailIcon,
  StepForwardIcon,
  UserRoundIcon,
} from "lucide-react";
import type { AgentCase, FlagId, PartPassport, PurchaseOrderDetail } from "@/contracts";
import { api, errorMessage, USE_MOCKS } from "@/lib/client/api";
import { invalidateAll, useApi, useNow } from "@/lib/client/hooks";
import { AGENT_STATE_LABEL, ALL_FLAGS, EVIDENCE_KIND_LABEL, IDENTITY_CHECK_LABEL, TERMINAL_STATES } from "@/lib/domain-meta";
import { countryName, formatDateTime, formatIn, formatUsd, poLabel, truncateMiddle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingRows, Panel } from "@/components/page";
import { AgentProgress, AgentTimeline } from "@/components/agent-timeline";
import { FlagGrid } from "@/components/flag-grid";
import { OverrideDialog } from "@/components/override-dialog";
import { EvidenceThread } from "@/components/evidence-thread";
import { PassportCard } from "@/components/passport";
import { AgentStateBadge, CheckStatusIcon, DECISION_STYLE, RunModeBadge } from "@/components/status";

/** "No red flags raised · 9 passed, 1 skipped (no data)", computed from the actual flag results. */
function flagSummary(flags: PurchaseOrderDetail["flags"], required?: FlagId[]): string | null {
  if (flags.length === 0) return null;
  const raised = flags.filter((f) => f.status === "flag").length;
  const passed = flags.filter((f) => f.status === "pass").length;
  const skips = flags.filter((f) => f.status === "skip");
  const noData = skips.filter((f) => !required || required.includes(f.flag)).length;
  const notRequired = required ? ALL_FLAGS.filter((id) => !required.includes(id)).length : skips.length - noData;
  const head = raised === 0 ? "No red flags raised" : `${raised} red flag${raised === 1 ? "" : "s"} raised`;
  const parts = [`${passed} passed`];
  if (noData) parts.push(`${noData} skipped (no data)`);
  if (notRequired) parts.push(`${notRequired} not required for this tier`);
  return `${head} · ${parts.join(", ")}`;
}

function DecisionBanner({ detail, requiredFlags }: { detail: PurchaseOrderDetail; requiredFlags?: FlagId[] }) {
  const { purchaseOrder: po, supplier, agentCase } = detail;
  const s = DECISION_STYLE[po.decision];
  const label = poLabel(po.id);
  const raised = detail.flags.filter((f) => f.status === "flag").length;
  const headline =
    po.decision === "pending"
      ? `The agent is working on ${label}`
      : po.humanOverride
        ? `${s.label} by human override`
        : `${s.label} by the agent`;
  const sub =
    po.decision === "pending"
      ? agentCase
        ? `Current step: ${AGENT_STATE_LABEL[agentCase.state]}. The order stays on hold until the policy gate decides.`
        : "No agent case attached."
      : po.decision === "approved"
        ? (flagSummary(detail.flags, requiredFlags) ?? po.decisionReasons[0] ?? "No red flags raised")
        : (po.decisionReasons[0] ?? flagSummary(detail.flags, requiredFlags) ?? `${raised} red flag${raised === 1 ? "" : "s"} raised`);
  const tone = {
    approved: "border-approved/30 bg-approved/[0.06]",
    quarantined: "border-quarantined/40 bg-quarantined/[0.08]",
    blocked: "border-blocked/30 bg-blocked/[0.06]",
    pending: "border-agent/25 bg-agent/[0.04]",
  }[po.decision];

  return (
    <div className={cn("overflow-hidden rounded-xl border", tone)}>
      <div className="flex flex-wrap items-start gap-4 p-5">
        <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl shadow-sm", s.solid)}>
          {po.decision === "pending" ? <BotIcon className="size-5" /> : <s.Icon className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono font-medium text-foreground">{label}</span>
            <span>·</span>
            <Link href={`/suppliers/${encodeURIComponent(supplier.id)}`} className="hover:text-foreground hover:underline">
              {supplier.legalName}
            </Link>
            <span>·</span>
            <span className="tabular">{formatUsd(po.amountUsd)}</span>
            <span>·</span>
            <span className="capitalize">{po.riskTier} risk tier</span>
            {po.quotedUnitPriceUsd !== undefined && (
              <>
                <span>·</span>
                <span className="tabular">{formatUsd(po.quotedUnitPriceUsd, true)}/unit</span>
              </>
            )}
            {po.quotedLeadTimeDays !== undefined && (
              <>
                <span>·</span>
                <span>{po.quotedLeadTimeDays}-day lead time</span>
              </>
            )}
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{headline}</h1>
          <p className="mt-0.5 max-w-3xl text-[13px] text-muted-foreground">{sub}</p>
          {po.humanOverride && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-quarantined/30 bg-background/70 px-3 py-2 text-xs">
              <UserRoundIcon className="mt-0.5 size-3.5 text-quarantined" />
              <div>
                <span className="font-medium">Human override</span> to {po.humanOverride.decision} at {formatDateTime(po.humanOverride.at)}:{" "}
                <span className="text-muted-foreground">“{po.humanOverride.reason}”</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {agentCase && !TERMINAL_STATES.includes(agentCase.state) && <AdvanceButtons caseId={agentCase.id} />}
          <OverrideDialog purchaseOrderId={po.id} current={po.decision} label={label} />
        </div>
      </div>
      {agentCase && (
        <div className="border-t bg-background/60 px-5 py-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <BotIcon className="size-3.5 text-agent" /> Autonomous pipeline
              <AgentStateBadge state={agentCase.state} />
              <span className="rounded border px-1 text-[10.5px] capitalize">{agentCase.riskTier} tier</span>
              <NextRun state={agentCase.state} nextRunAt={agentCase.nextRunAt} />
            </span>
            <span>
              Case <span className="font-mono">{agentCase.id}</span> · started {formatDateTime(agentCase.startedAt)}
            </span>
          </div>
          <AgentProgress state={agentCase.state} />
          {agentCase.escalationReason && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-blocked/30 bg-blocked/5 px-3 py-2 text-xs">
              <AlertOctagonIcon className="mt-0.5 size-3.5 text-blocked" />
              <div>
                <span className="font-medium text-blocked">Escalated to a human:</span> {agentCase.escalationReason}
              </div>
            </div>
          )}
        </div>
      )}
      {po.decisionJwt && (
        <div className="flex items-center gap-2 border-t bg-background/60 px-5 py-2 text-[11px] text-muted-foreground">
          <KeyRoundIcon className="size-3.5" />
          <span>Signed decision record</span>
          <span className="truncate font-mono" title={po.decisionJwt}>
            {truncateMiddle(po.decisionJwt, 40, 20)}
          </span>
          <button
            className="ml-auto shrink-0 hover:text-foreground"
            onClick={() => {
              navigator.clipboard?.writeText(po.decisionJwt!).then(
                () => toast.success("Decision JWT copied"),
                () => toast.error("Clipboard unavailable"),
              );
            }}
          >
            Copy
          </button>
        </div>
      )}
    </div>
  );
}

function NextRun({ state, nextRunAt }: { state: AgentCase["state"]; nextRunAt?: string }) {
  const now = useNow(1000);
  if (!nextRunAt || TERMINAL_STATES.includes(state)) return null;
  const label = state === "awaiting_supplier" ? "next re-chase" : "next step";
  return (
    <span className="inline-flex items-center gap-1 text-agent" title={nextRunAt}>
      <ClockIcon className="size-3" /> {label} {formatIn(nextRunAt, now)}
    </span>
  );
}

/** Manual nudges. The agent does not need them (autopilot ticks), but they help in a live demo. */
function AdvanceButtons({ caseId }: { caseId: string }) {
  const [busy, setBusy] = useState<"step" | "run" | null>(null);
  const go = async (kind: "step" | "run") => {
    setBusy(kind);
    try {
      const res = kind === "step" ? await api.stepCase(caseId) : await api.runCase(caseId);
      invalidateAll();
      toast(`Agent advanced ${res.newEvents.length} step${res.newEvents.length === 1 ? "" : "s"}`, {
        description: `Now: ${AGENT_STATE_LABEL[res.agentCase.state]}`,
      });
    } catch (e) {
      toast.error("Agent step failed", { description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => go("step")} disabled={!!busy} title="POST /api/agent/cases/:id/step">
        <StepForwardIcon /> Step
      </Button>
      <Button variant="outline" size="sm" onClick={() => go("run")} disabled={!!busy} title="POST /api/agent/cases/:id/run">
        <FastForwardIcon /> Run to next wait
      </Button>
    </>
  );
}

function PassportDiff({ passport, restricted }: { passport: PartPassport; restricted: string[] }) {
  const prev = useApi(passport.prevVersionId ? `passport:${passport.prevVersionId}` : null, () => api.getPassport(passport.prevVersionId!));
  if (!passport.prevVersionId) return null;
  if (prev.error) return <div className="text-xs text-muted-foreground">Previous version unavailable: {prev.error.message}</div>;
  if (!prev.data) return <div className="text-xs text-muted-foreground">Loading v{passport.version - 1}…</div>;
  const before = new Map(prev.data.components.map((c) => [c.name, c]));
  const changes = passport.components
    .map((c) => ({ after: c, before: before.get(c.name) }))
    .filter(({ after, before: b }) => !b || b.countryOfOrigin !== after.countryOfOrigin || b.supplierName !== after.supplierName);
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-3 py-2 text-xs font-medium">
        Changes from v{prev.data.version} → v{passport.version}{" "}
        <span className="font-normal text-muted-foreground">(passport version comparison, flag 10)</span>
      </div>
      {changes.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">No component origin or supplier changes.</div>
      ) : (
        <ul className="divide-y">
          {changes.map(({ after, before: b }) => {
            const bad = restricted.includes(after.countryOfOrigin);
            return (
              <li key={after.name} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="font-medium">{after.name}</span>
                <span className="text-muted-foreground line-through">
                  {b ? `${b.supplierName} (${countryName(b.countryOfOrigin)})` : "not present"}
                </span>
                <ArrowRightIcon className="size-3 text-muted-foreground" />
                <span className={cn(bad ? "font-medium text-blocked" : "")}>
                  {after.supplierName} ({countryName(after.countryOfOrigin)})
                </span>
                {bad && <span className="rounded border border-blocked/30 px-1 text-[10px] text-blocked uppercase">restricted</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function PurchaseOrderDetailView({ id }: { id: string }) {
  const q = useApi(`po:${id}`, () => api.getPurchaseOrder(id), 3000);
  const detail = q.data;
  const passportIds = detail?.purchaseOrder.passportIds ?? [];
  const passports = useApi(detail ? `po-passports:${passportIds.join(",")}` : null, () =>
    Promise.all(passportIds.map((p) => api.getPassport(p))),
  );
  const policy = useApi("policy", () => api.getPolicy());
  const supplier = useApi(detail ? `supplier:${detail.supplier.id}` : null, () => api.getSupplier(detail!.supplier.id));
  const outbox = useApi("outbox", () => api.outbox(), 4000);
  const caseId = q.data?.agentCase?.id;
  const caseEvents = useApi(caseId ? `case-events:${caseId}` : null, () => api.caseEvents(caseId!), 3000);
  const [showChecks, setShowChecks] = useState(false);

  if (q.error) {
    return (
      <div className="space-y-4">
        <Breadcrumb id={id} />
        <ErrorState error={q.error} onRetry={q.refresh} />
      </div>
    );
  }
  if (!detail) return <LoadingRows rows={8} />;

  const { purchaseOrder: po, agentCase, flags } = detail;
  const restricted = policy.data?.restrictedCountries ?? [];
  const messages = agentCase ? (outbox.data ?? []).filter((m) => m.caseId === agentCase.id) : [];
  const modeCounts = flags.reduce<Record<string, number>>((acc, f) => ((acc[f.mode] = (acc[f.mode] ?? 0) + 1), acc), {});
  const checks = supplier.data?.checks ?? [];

  return (
    <div className="space-y-5">
      <Breadcrumb id={id} />
      <DecisionBanner detail={detail} requiredFlags={policy.data?.tierFlags[po.riskTier]} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-5">
          {po.decisionReasons.length > 0 && (
            <Panel title="Why the agent decided this" description="Deterministic rules decide; Claude writes the explanation.">
              <ol className="space-y-2 px-4 py-3">
                {po.decisionReasons.map((r, i) => (
                  <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium tabular">
                      {i + 1}
                    </span>
                    <span>{r}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          <Panel
            title="Red-flag engine"
            description={`10 automatic checks. Policy: ${policy.data ? `quarantine at ${policy.data.quarantineAtFlagCount}, block at ${policy.data.blockAtFlagCount} flags` : "loading…"}`}
            actions={
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {(["live", "seeded", "simulated"] as const).map((m) =>
                  modeCounts[m] ? (
                    <span key={m} className="flex items-center gap-1">
                      <RunModeBadge mode={m} /> {modeCounts[m]}
                    </span>
                  ) : null,
                )}
              </div>
            }
            bodyClassName="p-4"
          >
            <FlagGrid flags={flags} requiredFlags={policy.data?.tierFlags[po.riskTier]} />
          </Panel>

          <Panel
            title="Evidence: part passports"
            description="Signed at manufacture. The signature, not the database row, is the proof."
            bodyClassName="space-y-4 p-4"
          >
            {passports.error ? (
              <ErrorState error={passports.error} onRetry={passports.refresh} />
            ) : !passports.data ? (
              <LoadingRows rows={3} className="p-0" />
            ) : passports.data.length === 0 ? (
              <div className="text-xs text-muted-foreground">No passports attached to this order.</div>
            ) : (
              passports.data.map((p) => (
                <div key={p.id} className="space-y-3">
                  <PassportDiff passport={p} restricted={restricted} />
                  <PassportCard passport={p} threshold={policy.data?.domesticContentThreshold} restricted={restricted} />
                </div>
              ))
            )}
          </Panel>

          <Panel
            title="Evidence: supplier identity (Loop 1)"
            description={supplier.data ? `${checks.filter((c) => c.status === "flag").length} of ${checks.length} checks flagged` : undefined}
            actions={
              <button onClick={() => setShowChecks((s) => !s)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronRightIcon className={cn("size-3 transition-transform", showChecks && "rotate-90")} />
                {showChecks ? "Hide" : "Show"} detail
              </button>
            }
          >
            {supplier.error ? (
              <div className="p-4">
                <ErrorState error={supplier.error} />
              </div>
            ) : !supplier.data ? (
              <LoadingRows rows={3} />
            ) : (
              <div className="divide-y">
                {checks.map((c) => (
                  <div key={c.kind} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 text-[13px]">
                      <CheckStatusIcon status={c.status} />
                      <span className="font-medium">{IDENTITY_CHECK_LABEL[c.kind].title}</span>
                      <span className="text-[11px] text-muted-foreground">{IDENTITY_CHECK_LABEL[c.kind].source}</span>
                      <span className="ml-auto font-mono text-[10.5px] text-muted-foreground uppercase">{c.source}</span>
                    </div>
                    {showChecks && (
                      <pre className="mt-1.5 overflow-x-auto rounded bg-muted/50 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap">
                        {JSON.stringify(c.evidence, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
                {supplier.data.documents.length > 0 && (
                  <div className="px-4 py-2.5">
                    <div className="mb-1 text-xs font-medium">Documents on file</div>
                    <ul className="flex flex-wrap gap-1.5">
                      {supplier.data.documents.map((d) => (
                        <li key={d.id} className="rounded-md border px-2 py-0.5 text-[11px]" title={`sha256 ${d.sha256}`}>
                          {EVIDENCE_KIND_LABEL[d.kind]} · <span className="font-mono">{d.filename}</span>
                          <span className="ml-1 text-muted-foreground">({d.receivedVia.replace("_", " ")})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-5 xl:sticky xl:top-16 xl:self-start">
          <Panel
            title={
              <span className="flex items-center gap-2">
                <BotIcon className="size-4 text-agent" /> Live agent timeline
              </span>
            }
            description="Every action the agent took on this order"
          >
            {agentCase ? (
              <AgentTimeline key={agentCase.id} caseId={agentCase.id} />
            ) : (
              <div className="p-4 text-xs text-muted-foreground">No agent case is attached to this order.</div>
            )}
          </Panel>

          <Panel
            title={
              <span className="flex items-center gap-2">
                <MailIcon className="size-4 text-brand" /> Evidence exchange via Naive
              </span>
            }
            description="The agent's requests and the supplier's replies, oldest first"
            actions={
              <Link href="/agent" className="text-xs text-muted-foreground hover:text-foreground">
                Outbox
              </Link>
            }
          >
            <EvidenceThread messages={messages} events={caseEvents.data ?? []} />
          </Panel>

          {agentCase && agentCase.gaps.length > 0 && (
            <Panel title="Evidence gaps" description="What the agent found missing and chased">
              <ul className="divide-y">
                {agentCase.gaps.map((g) => (
                  <li key={g.id} className="flex items-start gap-2.5 px-4 py-2.5 text-xs">
                    {g.resolvedAt ? (
                      <CircleCheckIcon className="mt-0.5 size-3.5 text-approved" />
                    ) : (
                      <ClockIcon className="mt-0.5 size-3.5 text-quarantined" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px]">{g.description}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {g.kind === "identity_field" ? "Identity field" : EVIDENCE_KIND_LABEL[g.kind]} · {g.attempts} request
                        {g.attempts === 1 ? "" : "s"}
                        {g.resolvedAt ? ` · resolved ${formatDateTime(g.resolvedAt)}` : g.requestedAt ? " · awaiting supplier" : " · not requested yet"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {USE_MOCKS && (
            <p className="px-1 text-[11px] text-muted-foreground">
              Mock data mode: this page is driven by the in-browser simulator, not the backend.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Breadcrumb({ id }: { id: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Link href="/purchase-orders" className="hover:text-foreground">
        Purchase orders
      </Link>
      <ChevronRightIcon className="size-3" />
      <span className="font-mono text-foreground">{poLabel(id)}</span>
    </div>
  );
}
