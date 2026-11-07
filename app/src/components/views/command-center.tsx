"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, BotIcon, MailIcon } from "lucide-react";
import type { DemoRunResponse, PurchaseOrderDetail } from "@/contracts";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { useAgentFeed } from "@/lib/client/use-agent-feed";
import { flagLabel } from "@/lib/domain-meta";
import { formatUsd, poLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, PageHeader, Panel } from "@/components/page";
import { AgentStateBadge, DecisionBadge } from "@/components/status";
import { DemoConflictNotice, DemoControls, DemoResultBanner, type DemoConflict } from "@/components/demo-controls";
import { CreatePoDialog } from "@/components/create-po-dialog";
import { EventRow } from "@/components/agent-timeline";

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "approved" | "quarantined" | "blocked" | "agent";
}) {
  const bar = {
    approved: "bg-approved",
    quarantined: "bg-quarantined",
    blocked: "bg-blocked",
    agent: "bg-agent",
  } as const;
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card px-4 py-3">
      {tone && <span className={cn("absolute inset-y-0 left-0 w-[3px]", bar[tone])} />}
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function PurchaseOrderTable({ rows, compact }: { rows: PurchaseOrderDetail[]; compact?: boolean }) {
  const router = useRouter();
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-4">Purchase order</TableHead>
          <TableHead>Supplier</TableHead>
          {!compact && <TableHead>Tier</TableHead>}
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Flags</TableHead>
          <TableHead className="pr-4">Decision</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ purchaseOrder: po, supplier, flags, agentCase }) => {
          const raised = flags.filter((f) => f.status === "flag");
          const href = `/purchase-orders/${encodeURIComponent(po.id)}`;
          return (
            <TableRow key={po.id} className="cursor-pointer" onClick={() => router.push(href)}>
              <TableCell className="pl-4">
                <Link href={href} className="font-mono text-xs font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                  {poLabel(po.id)}
                </Link>
              </TableCell>
              <TableCell className={compact ? "max-w-[190px]" : "max-w-[260px]"}>
                <div className="truncate font-medium">{supplier.legalName}</div>
                <div className="truncate text-[11px] text-muted-foreground">{supplier.domain}</div>
              </TableCell>
              {!compact && <TableCell className="text-muted-foreground capitalize">{po.riskTier}</TableCell>}
              <TableCell className="text-right tabular">{formatUsd(po.amountUsd)}</TableCell>
              <TableCell>{agentCase ? <AgentStateBadge state={agentCase.state} /> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="max-w-[124px] whitespace-normal">
                {raised.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{flags.length ? "none" : "—"}</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {raised.map((f) => (
                      <span key={f.flag} className="rounded border border-blocked/25 bg-blocked/8 px-1 font-mono text-[10.5px] text-blocked" title={f.explanation}>
                        {flagLabel(f.flag)}
                      </span>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell className="pr-4">
                <DecisionBadge decision={po.decision} overridden={!!po.humanOverride} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function CommandCenter() {
  const [demoResult, setDemoResult] = useState<DemoRunResponse | null>(null);
  const [demoConflict, setDemoConflict] = useState<DemoConflict | null>(null);
  const pos = useApi("purchase-orders", () => api.listPurchaseOrders(), 5000);
  const cases = useApi("cases", () => api.listCases(), 5000);
  const suppliers = useApi("suppliers", () => api.listSuppliers(), 10_000);
  const outbox = useApi("outbox", () => api.outbox(), 5000);
  const feed = useAgentFeed(2500, 14);

  const rows = pos.data ?? [];
  const sum = (d: string) => rows.filter((r) => r.purchaseOrder.decision === d);
  const approved = sum("approved");
  const quarantined = sum("quarantined");
  const blocked = sum("blocked");
  const decided = rows.filter((r) => r.purchaseOrder.decision !== "pending");
  const overrides = rows.filter((r) => r.purchaseOrder.humanOverride).length;
  const openCases = (cases.data ?? []).filter((c) => !["monitoring", "closed", "escalated"].includes(c.state)).length;
  const usd = (list: PurchaseOrderDetail[]) => formatUsd(list.reduce((s, r) => s + r.purchaseOrder.amountUsd, 0));
  const poByCase = new Map(rows.filter((r) => r.agentCase).map((r) => [r.agentCase!.id, r.purchaseOrder.id]));

  return (
    <div>
      <PageHeader
        eyebrow="Corvid Robotics · Procurement compliance"
        title="Command center"
        description="An autonomous agent verifies every supplier, collects missing evidence, signs proofs and gates each purchase order. Humans watch and override; they don't chase paperwork."
        actions={
          <>
            <CreatePoDialog />
            <DemoControls onResult={setDemoResult} onConflict={setDemoConflict} />
          </>
        }
      />
      {demoConflict && (
        <DemoConflictNotice conflict={demoConflict} onReset={() => setDemoConflict(null)} onDismiss={() => setDemoConflict(null)} />
      )}
      {demoResult && (
        <DemoResultBanner
          result={demoResult}
          onDismiss={() => setDemoResult(null)}
          decisionFor={(id) => rows.find((r) => r.purchaseOrder.id === id)?.purchaseOrder.decision}
          stateFor={(id) => rows.find((r) => r.purchaseOrder.id === id)?.agentCase?.state}
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Orders gated" value={rows.length} sub={rows.length ? `${usd(rows)} total` : "No orders yet"} />
        <Kpi label="Approved" value={approved.length} sub={usd(approved)} tone="approved" />
        <Kpi label="Quarantined" value={quarantined.length} sub={usd(quarantined)} tone="quarantined" />
        <Kpi label="Blocked" value={blocked.length} sub={`${usd(blocked)} stopped`} tone="blocked" />
        <Kpi
          label="Decided autonomously"
          value={decided.length ? `${Math.round(((decided.length - overrides) / decided.length) * 100)}%` : "—"}
          sub={`${overrides} human override${overrides === 1 ? "" : "s"} · ${openCases} open case${openCases === 1 ? "" : "s"}`}
          tone="agent"
        />
        <Kpi
          label="Supplier emails"
          value={outbox.data?.length ?? "—"}
          sub={outbox.data?.some((m) => m.provider === "naive") ? "sent via Naive" : "via Naive (stub, token pending)"}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <Panel
            title="Purchase orders"
            description="Every order is held until the agent's policy gate decides."
            actions={
              <Link href="/purchase-orders" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                All orders <ArrowRightIcon className="size-3" />
              </Link>
            }
          >
            {pos.error ? (
              <div className="p-4">
                <ErrorState error={pos.error} onRetry={pos.refresh} />
              </div>
            ) : pos.loading ? (
              <LoadingRows />
            ) : rows.length === 0 ? (
              <EmptyState title="No purchase orders yet">
                Click <strong>Run autonomous demo</strong> to create the three demo orders and watch the agent decide them, or create one
                yourself.
              </EmptyState>
            ) : (
              <PurchaseOrderTable rows={rows.slice(0, 8)} compact />
            )}
          </Panel>

          <Panel
            title="Suppliers"
            actions={
              <Link href="/suppliers" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                Manage <ArrowRightIcon className="size-3" />
              </Link>
            }
          >
            {suppliers.error ? (
              <div className="p-4">
                <ErrorState error={suppliers.error} onRetry={suppliers.refresh} />
              </div>
            ) : suppliers.loading ? (
              <LoadingRows rows={3} />
            ) : (
              <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
                {(suppliers.data ?? []).map(({ supplier, latestDecision, openFlagCount }) => (
                  <Link key={supplier.id} href={`/suppliers/${encodeURIComponent(supplier.id)}`} className="block px-4 py-3 hover:bg-muted/40">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{supplier.legalName}</span>
                      {latestDecision && <DecisionBadge decision={latestDecision} />}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {supplier.address.city}, {supplier.address.state} · {supplier.domain}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                      <span
                        className={cn(
                          "rounded border px-1.5",
                          supplier.status === "enrolled" ? "border-approved/25 text-approved" : "border-border text-muted-foreground",
                        )}
                      >
                        {supplier.status === "enrolled" ? "Credential issued" : supplier.status === "draft" ? "Credential withheld" : "Revoked"}
                      </span>
                      {openFlagCount > 0 && <span className="text-blocked">{openFlagCount} open flag{openFlagCount === 1 ? "" : "s"}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <BotIcon className="size-4 text-agent" /> Agent activity
            </span>
          }
          description="Every step the agent takes, newest first"
          actions={
            <Link href="/agent" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Console <ArrowRightIcon className="size-3" />
            </Link>
          }
          className="xl:sticky xl:top-16 xl:self-start"
        >
          {feed.error ? (
            <div className="p-4">
              <ErrorState error={feed.error} />
            </div>
          ) : feed.loading || cases.loading ? (
            <LoadingRows rows={6} />
          ) : (feed.data ?? []).length === 0 ? (
            <EmptyState title="Agent idle" icon={<BotIcon />}>
              No cases yet. Create a purchase order or run the demo.
            </EmptyState>
          ) : (
            <ol className="max-h-[640px] overflow-y-auto px-2 py-2">
              {(feed.data ?? []).map((e, i, arr) => {
                const poId = poByCase.get(e.caseId);
                return (
                  <EventRow
                    key={e.id}
                    event={e}
                    last={i === arr.length - 1}
                    showCase={poId ? poLabel(poId) : e.caseId}
                    caseHref={poId ? `/purchase-orders/${encodeURIComponent(poId)}` : undefined}
                  />
                );
              })}
            </ol>
          )}
          <div className="flex items-center justify-between border-t px-4 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <MailIcon className="size-3" /> {outbox.data?.length ?? 0} supplier emails in outbox
            </span>
            <Link href="/agent" className="hover:text-foreground">
              View outbox
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}
