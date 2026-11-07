import {
  BanIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleIcon,
  CircleMinusIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentState, Decision, FlagResult, IdentityCheckResult, OutboundMessage, RunMode } from "@/contracts";
import { AGENT_STATE_LABEL, RUN_MODE_HINT, TERMINAL_STATES } from "@/lib/domain-meta";

const pill =
  "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium whitespace-nowrap [&_svg]:size-3";

export const DECISION_STYLE: Record<Decision, { label: string; cls: string; solid: string; Icon: typeof CircleIcon }> = {
  approved: {
    label: "Approved",
    cls: "border-approved/25 bg-approved/10 text-approved",
    solid: "bg-approved text-white",
    Icon: CheckCircle2Icon,
  },
  quarantined: {
    label: "Quarantined",
    cls: "border-quarantined/30 bg-quarantined/12 text-[color-mix(in_oklch,var(--quarantined),black_25%)]",
    solid: "bg-quarantined text-white",
    Icon: ShieldAlertIcon,
  },
  blocked: {
    label: "Blocked",
    cls: "border-blocked/25 bg-blocked/10 text-blocked",
    solid: "bg-blocked text-white",
    Icon: BanIcon,
  },
  pending: {
    label: "Pending",
    cls: "border-pending/25 bg-pending/10 text-pending",
    solid: "bg-pending text-white",
    Icon: CircleDashedIcon,
  },
};

export function DecisionBadge({ decision, className, overridden }: { decision: Decision; className?: string; overridden?: boolean }) {
  const s = DECISION_STYLE[decision];
  return (
    <span className={cn(pill, s.cls, className)}>
      <s.Icon />
      {s.label}
      {overridden && <span className="font-normal opacity-75">· override</span>}
    </span>
  );
}

export function AgentStateBadge({ state, className }: { state: AgentState; className?: string }) {
  const terminal = TERMINAL_STATES.includes(state);
  const escalated = state === "escalated";
  return (
    <span
      className={cn(
        pill,
        escalated
          ? "border-blocked/25 bg-blocked/10 text-blocked"
          : terminal
            ? "border-border bg-muted text-muted-foreground"
            : "border-agent/25 bg-agent/10 text-agent",
        className,
      )}
    >
      {!terminal && <span className="size-1.5 rounded-full bg-agent animate-pulse-dot" />}
      {AGENT_STATE_LABEL[state]}
    </span>
  );
}

export function RunModeBadge({ mode, className }: { mode: RunMode; className?: string }) {
  const cls =
    mode === "live"
      ? "border-approved/25 text-approved"
      : mode === "seeded"
        ? "border-brand/25 text-brand"
        : "border-dashed border-muted-foreground/40 text-muted-foreground";
  return (
    <span title={RUN_MODE_HINT[mode]} className={cn(pill, "bg-transparent uppercase tracking-wide text-[10px]", cls, className)}>
      {mode}
    </span>
  );
}

export function CheckStatusIcon({ status, className }: { status: IdentityCheckResult["status"] | FlagResult["status"]; className?: string }) {
  switch (status) {
    case "pass":
      return <CheckCircle2Icon className={cn("size-4 text-approved", className)} />;
    case "flag":
      return <TriangleAlertIcon className={cn("size-4 text-blocked", className)} />;
    case "error":
      return <XCircleIcon className={cn("size-4 text-quarantined", className)} />;
    default:
      return <CircleMinusIcon className={cn("size-4 text-muted-foreground/60", className)} />;
  }
}

export function CheckStatusBadge({ status }: { status: IdentityCheckResult["status"] | FlagResult["status"] }) {
  const cls =
    status === "pass"
      ? "border-approved/25 bg-approved/10 text-approved"
      : status === "flag"
        ? "border-blocked/25 bg-blocked/10 text-blocked"
        : status === "error"
          ? "border-quarantined/30 bg-quarantined/10 text-quarantined"
          : "border-border bg-muted text-muted-foreground";
  return <span className={cn(pill, cls, "uppercase tracking-wide text-[10px]")}>{status}</span>;
}

export function ProviderBadge({ provider }: { provider: OutboundMessage["provider"] }) {
  return provider === "naive" ? (
    <span className={cn(pill, "border-brand/25 bg-brand/10 text-brand")}>
      <span className="size-1.5 rounded-full bg-brand" />
      Naive
    </span>
  ) : (
    <span
      className={cn(pill, "border-dashed border-quarantined/50 bg-quarantined/8 text-[color-mix(in_oklch,var(--quarantined),black_25%)]")}
      title="Sent through the Naive adapter in stub mode. Set NAIVE_API_KEY to deliver for real."
    >
      Naive (stub — token pending)
    </span>
  );
}

export function LiveDot({ active = true, className }: { active?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2", className)}>
      {active && <span className="absolute inline-flex size-full animate-ping rounded-full bg-approved opacity-60" />}
      <span className={cn("relative inline-flex size-2 rounded-full", active ? "bg-approved" : "bg-muted-foreground/40")} />
    </span>
  );
}
