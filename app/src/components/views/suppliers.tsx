"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import type { Supplier } from "@/contracts";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, PageHeader, Panel } from "@/components/page";
import { DecisionBadge } from "@/components/status";

export function CredentialBadge({ supplier }: { supplier: Supplier }) {
  const map = {
    enrolled: { label: supplier.credentialJwt ? "Credential issued" : "Enrolled", cls: "border-approved/25 bg-approved/10 text-approved" },
    draft: { label: "Credential withheld", cls: "border-border bg-muted text-muted-foreground" },
    revoked: { label: "Credential revoked", cls: "border-blocked/25 bg-blocked/10 text-blocked" },
  } as const;
  const m = map[supplier.status];
  return <span className={cn("inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-medium whitespace-nowrap", m.cls)}>{m.label}</span>;
}

export function SuppliersView() {
  const router = useRouter();
  const q = useApi("suppliers", () => api.listSuppliers(), 8000);
  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Each supplier enrolls once (Loop 1: identity, sanctions, facility, history) and receives a signed credential any buyer can verify."
        actions={
          <Link href="/suppliers/enroll" className={buttonVariants()}>
            <PlusIcon /> Enroll supplier
          </Link>
        }
      />
      <Panel>
        {q.error ? (
          <div className="p-4">
            <ErrorState error={q.error} onRetry={q.refresh} />
          </div>
        ) : q.loading ? (
          <LoadingRows rows={4} />
        ) : (q.data ?? []).length === 0 ? (
          <EmptyState title="No suppliers">Reset the demo to reseed suppliers A, B and C, or enroll one.</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Supplier</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>UEI · CAGE</TableHead>
                <TableHead>Credential</TableHead>
                <TableHead>Latest decision</TableHead>
                <TableHead>Open flags</TableHead>
                <TableHead className="pr-4">Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data ?? []).map(({ supplier: s, latestDecision, openFlagCount }) => {
                const href = `/suppliers/${encodeURIComponent(s.id)}`;
                return (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => router.push(href)}>
                    <TableCell className="pl-4">
                      <Link href={href} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {s.legalName}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">{s.domain}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.address.city}, {s.address.state} {s.address.country}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {s.uei ?? "—"} · {s.cageCode ?? "—"}
                    </TableCell>
                    <TableCell>
                      <CredentialBadge supplier={s} />
                    </TableCell>
                    <TableCell>{latestDecision ? <DecisionBadge decision={latestDecision} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className={cn("tabular", openFlagCount > 0 ? "font-medium text-blocked" : "text-muted-foreground")}>{openFlagCount}</TableCell>
                    <TableCell className="pr-4 text-muted-foreground">{formatDate(s.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
