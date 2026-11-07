"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { InfoIcon, PlayIcon, RotateCcwIcon, SparklesIcon, XIcon } from "lucide-react";
import type { AgentState, Decision, DemoRunResponse } from "@/contracts";
import { api, ApiClientError, errorMessage } from "@/lib/client/api";
import { invalidateAll } from "@/lib/client/hooks";
import { poLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { AgentStateBadge, DecisionBadge } from "@/components/status";

const SCENARIO: Record<"A" | "B" | "C", string> = {
  A: "Legitimate actuator manufacturer",
  B: "US assembler, hidden sub-tier move",
  C: "Impersonator",
};

/** POST /api/demo/reset with toasts; shared by the header button and the "already ran" notice. */
function useResetDemo(onDone: () => void) {
  const [resetting, setResetting] = useState(false);
  const reset = async () => {
    setResetting(true);
    try {
      await api.resetDemo();
      onDone();
      invalidateAll();
      toast("Demo reset", { description: "Suppliers A/B/C, policy, passports and documents reseeded." });
    } catch (e) {
      toast.error("Reset failed", { description: errorMessage(e) });
    } finally {
      setResetting(false);
    }
  };
  return { reset, resetting };
}

export function DemoControls({
  onResult,
  onConflict,
}: {
  onResult: (r: DemoRunResponse | null) => void;
  /** Called when the demo already ran (409) with the server message and the existing demo orders, or null to clear. */
  onConflict: (conflict: DemoConflict | null) => void;
}) {
  const [running, setRunning] = useState(false);
  const { reset, resetting } = useResetDemo(() => {
    onResult(null);
    onConflict(null);
  });

  const run = async () => {
    setRunning(true);
    onConflict(null);
    try {
      const res = await api.runDemo();
      onResult(res);
      invalidateAll();
      toast.success("Agent started on 3 demo purchase orders", {
        description: "No further clicks needed: the autopilot drives each case to a decision.",
      });
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) {
        const results = (e.details as { results?: DemoRunResponse["results"] } | undefined)?.results ?? [];
        onConflict({ message: e.message, results });
      }
      else toast.error("Demo run failed", { description: errorMessage(e) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={reset} disabled={resetting || running}>
        <RotateCcwIcon className={resetting ? "animate-spin" : ""} />
        Reset demo
      </Button>
      <Button onClick={run} disabled={running || resetting} className="bg-agent text-white hover:bg-agent/90">
        {running ? <SparklesIcon className="animate-pulse" /> : <PlayIcon />}
        {running ? "Agent running…" : "Run autonomous demo"}
      </Button>
    </div>
  );
}

export interface DemoConflict {
  message: string;
  results: DemoRunResponse["results"];
}

/** Inline notice for POST /api/demo/run → 409: the demo POs already exist. */
export function DemoConflictNotice({ conflict, onReset, onDismiss }: { conflict: DemoConflict; onReset: () => void; onDismiss: () => void }) {
  const { message, results } = conflict;
  const { reset, resetting } = useResetDemo(onReset);
  return (
    <div className="relative mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-quarantined/40 bg-quarantined/[0.07] px-4 py-3 pr-10">
      <InfoIcon className="size-4 text-[color-mix(in_oklch,var(--quarantined),black_25%)]" />
      <div className="min-w-0 flex-1 text-[13px]" title={`Server: ${message}`}>
        <span className="font-medium">The demo has already run.</span>{" "}
        <span className="text-muted-foreground">Reset to reseed suppliers A, B and C, then run it again.</span>
        {results.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {results.map((r) => (
              <Link
                key={r.purchaseOrderId}
                href={`/purchase-orders/${encodeURIComponent(r.purchaseOrderId)}`}
                className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs hover:border-foreground/20"
              >
                <span className="font-semibold">{r.supplierLabel}</span>
                <span className="font-mono text-muted-foreground">{poLabel(r.purchaseOrderId)}</span>
                <DecisionBadge decision={r.decision} />
              </Link>
            ))}
          </div>
        )}
      </div>
      <Button size="sm" onClick={reset} disabled={resetting}>
        <RotateCcwIcon className={resetting ? "animate-spin" : ""} />
        {resetting ? "Resetting…" : "Reset demo"}
      </Button>
      <button onClick={onDismiss} className="absolute top-2 right-2 rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Dismiss">
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

export function DemoResultBanner({
  result,
  onDismiss,
  decisionFor,
  stateFor,
}: {
  result: DemoRunResponse;
  onDismiss: () => void;
  stateFor?: (purchaseOrderId: string) => AgentState | undefined;
  /** Live decision lookup; demo/run returns before the agent has decided. */
  decisionFor?: (purchaseOrderId: string) => Decision | undefined;
}) {
  const decisions = result.results.map((r) => decisionFor?.(r.purchaseOrderId) ?? r.decision);
  const done = decisions.every((d) => d !== "pending");
  return (
    <div className="relative mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-agent/25 bg-agent/[0.04] px-4 py-3 pr-10">
      <SparklesIcon className={done ? "size-4 text-agent" : "size-4 animate-pulse text-agent"} />
      <span className="text-[13px] font-medium">
        {done
          ? `The agent decided ${result.results.length} purchase orders end to end with no human input:`
          : `The agent is working ${result.results.length} purchase orders on its own. Watch the activity feed:`}
      </span>
      {result.results.map((r, i) => (
        <Link
          key={r.purchaseOrderId}
          href={`/purchase-orders/${encodeURIComponent(r.purchaseOrderId)}`}
          className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1 text-xs hover:border-foreground/20"
        >
          <span className="font-semibold">{r.supplierLabel}</span>
          <span className="text-muted-foreground">{SCENARIO[r.supplierLabel]}</span>
          <span className="font-mono text-muted-foreground">{poLabel(r.purchaseOrderId)}</span>
          {decisions[i] === "pending" && stateFor?.(r.purchaseOrderId) ? (
            <AgentStateBadge state={stateFor(r.purchaseOrderId)!} />
          ) : (
            <DecisionBadge decision={decisions[i]} />
          )}
        </Link>
      ))}
      {!done && (
        <Link href="/agent" className="text-xs font-medium text-agent hover:underline">
          Watch live in Agent operations →
        </Link>
      )}
      <button onClick={onDismiss} className="absolute top-2 right-2 rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Dismiss">
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
