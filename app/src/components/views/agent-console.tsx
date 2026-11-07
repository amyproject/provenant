"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertOctagonIcon, BotIcon, CheckCheckIcon, HourglassIcon, MailIcon, RadarIcon, ZapIcon } from "lucide-react";
import type { AgentCase, AgentEvent, OutboundMessage } from "@/contracts";
import { api, errorMessage } from "@/lib/client/api";
import { invalidateAll, useApi, useNow } from "@/lib/client/hooks";
import { useAgentFeed } from "@/lib/client/use-agent-feed";
import { formatIn, formatRelative, poLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingRows, PageHeader, Panel } from "@/components/page";
import { AgentStateBadge, DecisionBadge } from "@/components/status";
import { ACTOR_STYLE, EventRow } from "@/components/agent-timeline";
import { EvidenceThread } from "@/components/evidence-thread";
import { useAutopilot } from "@/components/autopilot";

const LANES: { key: string; title: string; Icon: typeof BotIcon; match: (c: AgentCase) => boolean; tone: string }[] = [
  {
    key: "working",
    title: "Agent working",
    Icon: BotIcon,
    match: (c) => !["awaiting_supplier", "monitoring", "closed", "escalated"].includes(c.state),
    tone: "text-agent",
  },
  { key: "waiting", title: "Waiting on supplier", Icon: HourglassIcon, match: (c) => c.state === "awaiting_supplier", tone: "text-brand" },
  { key: "escalated", title: "Escalated to a human", Icon: AlertOctagonIcon, match: (c) => c.state === "escalated", tone: "text-blocked" },
  { key: "done", title: "Decided · monitoring", Icon: CheckCheckIcon, match: (c) => c.state === "monitoring" || c.state === "closed", tone: "text-approved" },
];

function CaseCard({ c, supplierName, now }: { c: AgentCase; supplierName?: string; now: number }) {
  const open = c.gaps.filter((g) => !g.resolvedAt).length;
  return (
    <Link
      href={`/purchase-orders/${encodeURIComponent(c.purchaseOrderId)}`}
      className="block rounded-lg border bg-card p-3 transition-colors hover:border-foreground/20"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium">{poLabel(c.purchaseOrderId)}</span>
        <DecisionBadge decision={c.decision} />
      </div>
      <div className="mt-1 truncate text-[13px] font-medium">{supplierName ?? c.supplierId}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <AgentStateBadge state={c.state} />
        <span className="rounded border px-1 text-[10.5px] text-muted-foreground capitalize">{c.riskTier} tier</span>
        {c.gaps.length > 0 && (
          <span className={cn("text-[11px]", open ? "text-quarantined" : "text-muted-foreground")}>
            {open ? `${open} open gap${open === 1 ? "" : "s"}` : `${c.gaps.length} gap${c.gaps.length === 1 ? "" : "s"} closed`}
          </span>
        )}
      </div>
      {c.escalationReason && <div className="mt-2 text-[11px] text-blocked">{c.escalationReason}</div>}
      <div className="mt-2 flex items-center justify-between text-[10.5px] text-muted-foreground">
        <span>updated {formatRelative(c.updatedAt, now)}</span>
        {c.nextRunAt && c.state !== "monitoring" && c.state !== "closed" && (
          <span title={c.nextRunAt}>
            next step {formatIn(c.nextRunAt, now)}
          </span>
        )}
      </div>
    </Link>
  );
}

export function AgentConsole() {
  const cases = useApi("cases", () => api.listCases(), 3000);
  const suppliers = useApi("suppliers", () => api.listSuppliers(), 15_000);
  const outbox = useApi("outbox", () => api.outbox(), 3000);
  const feed = useAgentFeed(2000);
  const autopilot = useAutopilot();
  const now = useNow(1000);
  const [actor, setActor] = useState<AgentEvent["actor"] | "all">("all");
  const [ticking, setTicking] = useState(false);

  const names = new Map((suppliers.data ?? []).map((s) => [s.supplier.id, s.supplier.legalName]));
  const caseToPo = new Map((cases.data ?? []).map((c) => [c.id, c.purchaseOrderId]));
  const events = (feed.data ?? []).filter((e) => actor === "all" || e.actor === actor);
  const threads = (() => {
    const map = new Map<string, { caseId: string; messages: OutboundMessage[]; replies: AgentEvent[]; last: string }>();
    const get = (id: string) => {
      let t = map.get(id);
      if (!t) map.set(id, (t = { caseId: id, messages: [], replies: [], last: "" }));
      return t;
    };
    for (const m of outbox.data ?? []) {
      const t = get(m.caseId);
      t.messages.push(m);
      if (m.sentAt > t.last) t.last = m.sentAt;
    }
    for (const e of feed.data ?? []) {
      if (e.actor !== "supplier") continue;
      const t = get(e.caseId);
      t.replies.push(e);
      if (e.at > t.last) t.last = e.at;
    }
    return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
  })();
  const agentSteps = (feed.data ?? []).filter((e) => e.actor === "agent").length;
  const humanSteps = (feed.data ?? []).filter((e) => e.actor === "human").length;

  const tickNow = async () => {
    setTicking(true);
    try {
      const res = await api.tick();
      invalidateAll();
      toast(`Heartbeat advanced ${res.advanced.length} case${res.advanced.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error("Tick failed", { description: errorMessage(e) });
    } finally {
      setTicking(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Agent operations"
        description="Every compliance case the agent is running, what it is waiting on, and every email it sent. The agent advances cases on its own heartbeat; humans step in only on escalation."
        actions={
          <Button variant="outline" onClick={tickNow} disabled={ticking} title="POST /api/agent/tick">
            <ZapIcon /> Tick heartbeat now
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Autopilot"
          value={autopilot.status ? (autopilot.status.enabled ? "On" : "Off") : "—"}
          sub={
            autopilot.status
              ? `server heartbeat · ${autopilot.status.lastTickAt ? `last tick ${formatRelative(autopilot.status.lastTickAt, now)}` : "no ticks yet"}`
              : autopilot.error ?? "checking…"
          }
          tone={autopilot.status?.enabled ? "agent" : undefined}
        />
        <Stat label="Cases" value={cases.data?.length ?? "—"} sub={`${(cases.data ?? []).filter((c) => LANES[0].match(c)).length} in progress`} />
        <Stat label="Agent actions" value={agentSteps} sub={`${humanSteps} human action${humanSteps === 1 ? "" : "s"}`} />
        <Stat
          label="Supplier emails"
          value={outbox.data?.length ?? "—"}
          sub={outbox.data?.some((m) => m.provider === "naive") ? "delivered via Naive" : "Naive stub (token pending)"}
        />
      </div>

      {cases.error ? (
        <ErrorState error={cases.error} onRetry={cases.refresh} />
      ) : cases.loading ? (
        <LoadingRows rows={3} />
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-4">
          {LANES.map((lane) => {
            const list = (cases.data ?? []).filter(lane.match);
            return (
              <div key={lane.key} className="rounded-xl border bg-muted/30 p-2">
                <div className="flex items-center gap-2 px-1.5 pt-0.5 pb-2 text-xs font-medium">
                  <lane.Icon className={cn("size-3.5", lane.tone)} />
                  {lane.title}
                  <span className="ml-auto text-muted-foreground tabular">{list.length}</span>
                </div>
                <div className="space-y-2">
                  {list.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-3 py-5 text-center text-[11px] text-muted-foreground">None</div>
                  ) : (
                    list.map((c) => <CaseCard key={c.id} c={c} supplierName={names.get(c.supplierId)} now={now} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <RadarIcon className="size-4 text-agent" /> Event stream
            </span>
          }
          description="All cases, newest first"
          actions={
            <div className="flex gap-0.5">
              {(["all", "agent", "supplier", "human", "system"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setActor(a)}
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[11px] capitalize",
                    actor === a ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {a === "all" ? "All" : ACTOR_STYLE[a].label}
                </button>
              ))}
            </div>
          }
        >
          {feed.error ? (
            <div className="p-4">
              <ErrorState error={feed.error} />
            </div>
          ) : feed.loading ? (
            <LoadingRows rows={6} />
          ) : events.length === 0 ? (
            <EmptyState title="No events" icon={<BotIcon />}>
              Run the demo or create a purchase order to start a case.
            </EmptyState>
          ) : (
            <ol className="max-h-[720px] overflow-y-auto px-2 py-2">
              {events.map((e, i) => {
                const poId = caseToPo.get(e.caseId);
                return (
                  <EventRow
                    key={e.id}
                    event={e}
                    last={i === events.length - 1}
                    showCase={poId ? poLabel(poId) : e.caseId}
                    caseHref={poId ? `/purchase-orders/${encodeURIComponent(poId)}` : undefined}
                  />
                );
              })}
            </ol>
          )}
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <MailIcon className="size-4 text-brand" /> Outbox · supplier conversations
            </span>
          }
          description="Each case's evidence requests sent through Naive and the supplier replies the agent ingested"
        >
          {outbox.error ? (
            <div className="p-4">
              <ErrorState error={outbox.error} onRetry={outbox.refresh} />
            </div>
          ) : outbox.loading ? (
            <LoadingRows rows={4} />
          ) : (
            <div className="max-h-[720px] divide-y overflow-y-auto">
              {threads.length === 0 ? (
                <EvidenceThread messages={[]} events={[]} />
              ) : (
                threads.map((t) => {
                  const poId = caseToPo.get(t.caseId);
                  const c = (cases.data ?? []).find((x) => x.id === t.caseId);
                  return (
                    <div key={t.caseId}>
                      <div className="flex items-center gap-2 bg-muted/30 px-4 py-2 text-xs">
                        {poId ? (
                          <Link href={`/purchase-orders/${encodeURIComponent(poId)}`} className="font-mono font-medium text-brand hover:underline">
                            {poLabel(poId)}
                          </Link>
                        ) : (
                          <span className="font-mono">{t.caseId}</span>
                        )}
                        <span className="truncate font-medium">{c ? names.get(c.supplierId) ?? c.supplierId : ""}</span>
                        <span className="ml-auto text-muted-foreground">
                          {t.messages.length} sent · {t.replies.length} repl{t.replies.length === 1 ? "y" : "ies"}
                        </span>
                      </div>
                      <EvidenceThread messages={t.messages} events={t.replies} />
                    </div>
                  );
                })
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "agent" }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular", tone === "agent" && "text-agent")}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
