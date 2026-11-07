"use client";

import { useState } from "react";
import type { Decision } from "@/contracts";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingRows, PageHeader, Panel } from "@/components/page";
import { CreatePoDialog } from "@/components/create-po-dialog";
import { DECISION_STYLE } from "@/components/status";
import { PurchaseOrderTable } from "@/components/views/command-center";

const FILTERS: (Decision | "all")[] = ["all", "pending", "approved", "quarantined", "blocked"];

export function PurchaseOrdersView() {
  const [filter, setFilter] = useState<Decision | "all">("all");
  const pos = useApi("purchase-orders", () => api.listPurchaseOrders(), 5000);
  const rows = (pos.data ?? []).filter((r) => filter === "all" || r.purchaseOrder.decision === filter);
  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="Each order is gated by the agent: approve, quarantine or block, with a signed decision record."
        actions={<CreatePoDialog />}
      />
      <Panel
        title={
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => {
              const count = (pos.data ?? []).filter((r) => f === "all" || r.purchaseOrder.decision === f).length;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-medium",
                    filter === f ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f === "all" ? "All" : DECISION_STYLE[f].label} <span className="ml-0.5 text-muted-foreground tabular">{count}</span>
                </button>
              );
            })}
          </div>
        }
      >
        {pos.error ? (
          <div className="p-4">
            <ErrorState error={pos.error} onRetry={pos.refresh} />
          </div>
        ) : pos.loading ? (
          <LoadingRows rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState title="No purchase orders match">Run the demo from the command center or create a purchase order.</EmptyState>
        ) : (
          <PurchaseOrderTable rows={rows} />
        )}
      </Panel>
    </div>
  );
}
