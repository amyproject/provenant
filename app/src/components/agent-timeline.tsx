"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BotIcon, Building2Icon, ChevronRightIcon, CogIcon, MailIcon, UserRoundIcon } from "lucide-react";
import type { AgentEvent, AgentState } from "@/contracts";
import { api, errorMessage } from "@/lib/client/api";
import { useNow } from "@/lib/client/hooks";
import { AGENT_PIPELINE, AGENT_STATE_HINT, AGENT_STATE_LABEL } from "@/lib/domain-meta";
import { formatRelative, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EvidenceView } from "@/components/evidence-view";
import { LiveDot } from "@/components/status";

export const ACTOR_STYLE: Record<AgentEvent["actor"], { Icon: typeof BotIcon; cls: string; label: string }> = {
  agent: { Icon: BotIcon, cls: "bg-agent/12 text-agent ring-agent/25", label: "Agent" },
  supplier: { Icon: Building2Icon, cls: "bg-brand/10 text-brand ring-brand/25", label: "Supplier" },
  human: { Icon: UserRoundIcon, cls: "bg-quarantined/15 text-[color-mix(in_oklch,var(--quarantined),black_30%)] ring-quarantined/30", label: "Human" },
  system: { Icon: CogIcon, cls: "bg-muted text-muted-foreground ring-border", label: "System" },
};

export function EventRow({
  event,
  isNew,
  showCase,
  caseHref,
  last,
}: {
  event: AgentEvent;
  isNew?: boolean;
  showCase?: React.ReactNode;
  caseHref?: string;
  last?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const a = ACTOR_STYLE[event.actor];
  const hasDetail = !!event.detail && Object.keys(event.detail).length > 0;
  const inbound = event.actor === "supplier";
  const outbound = !inbound && /via naive/i.test(event.summary);
  return (
    <li className={cn("relative flex gap-3 rounded-md px-2 py-2", inbound && "bg-brand/[0.05]", outbound && "bg-agent/[0.04]", isNew && "animate-event-in")}>
      {!last && <span className="absolute top-9 bottom-[-0.5rem] left-[1.4rem] w-px bg-border" aria-hidden />}
      <span className={cn("relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ring-1", a.cls)}>
        <a.Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="font-mono tabular">{formatTime(event.at)}</span>
          <span>·</span>
          <span className="font-medium text-foreground/80">{a.label}</span>
          <span>·</span>
          <span title={AGENT_STATE_HINT[event.state]}>{AGENT_STATE_LABEL[event.state]}</span>
          {(inbound || outbound) && (
            <span className={cn("inline-flex items-center gap-1 rounded border px-1 text-[10px]", inbound ? "border-brand/30 text-brand" : "border-agent/30 text-agent")}>
              <MailIcon className="size-2.5" /> {inbound ? "reply via Naive" : "sent via Naive"}
            </span>
          )}
          {showCase &&
            (caseHref ? (
              <Link href={caseHref} className="font-mono text-brand hover:underline">
                {showCase}
              </Link>
            ) : (
              <span className="font-mono">{showCase}</span>
            ))}
        </div>
        <div className="mt-0.5 text-[13px] leading-5 text-foreground">{event.summary}</div>
        {hasDetail && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} />
            {open ? "Hide detail" : "Detail"}
          </button>
        )}
        {open && hasDetail && <EvidenceView data={event.detail} className="mt-1.5 rounded-md border bg-muted/30 p-2" />}
      </div>
    </li>
  );
}

/**
 * Live timeline for one agent case. Loads the full history, then polls
 * GET /api/agent/cases/:id/events?after=<lastId> and appends new events.
 */
export function AgentTimeline({
  caseId,
  pollMs = 2000,
  className,
  maxHeightClass = "max-h-[560px]",
}: {
  caseId: string;
  pollMs?: number;
  className?: string;
  maxHeightClass?: string;
}) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [lastPoll, setLastPoll] = useState<number>();
  const scroller = useRef<HTMLDivElement>(null);
  const now = useNow(1000);

  useEffect(() => {
    let active = true;
    let lastId: string | undefined;
    let first = true;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const evs = await api.caseEvents(caseId, lastId);
        if (!active) return;
        setLastPoll(Date.now());
        setError(undefined);
        if (evs.length > 0) {
          lastId = evs[evs.length - 1].id;
          setEvents((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            return [...prev, ...evs.filter((e) => !seen.has(e.id))];
          });
          if (!first) setNewIds((prev) => new Set([...prev, ...evs.map((e) => e.id)]));
        }
        first = false;
        setLoaded(true);
      } catch (e) {
        if (active) setError(errorMessage(e));
      } finally {
        inFlight = false;
      }
    };
    poll();
    const t = setInterval(poll, pollMs);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [caseId, pollMs]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between border-b px-4 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <LiveDot active={!error} />
          {error ? <span className="text-blocked">Polling failed: {error}</span> : <span>Live · polling every {pollMs / 1000}s</span>}
        </span>
        <span className="tabular">
          {events.length} events{lastPoll ? ` · updated ${formatRelative(new Date(lastPoll).toISOString(), now)}` : ""}
        </span>
      </div>
      <div ref={scroller} className={cn("overflow-y-auto px-2 py-2", maxHeightClass)}>
        {!loaded && !error ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading agent events…</div>
        ) : events.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">No events yet. The agent will log every step here.</div>
        ) : (
          <ol>
            {events.map((e, i) => (
              <EventRow key={e.id} event={e} isNew={newIds.has(e.id)} last={i === events.length - 1} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** Horizontal rail showing where the case is in the autonomous pipeline. */
export function AgentProgress({ state, className }: { state: AgentState; className?: string }) {
  const closed = state === "closed";
  const escalated = state === "escalated";
  const idx = closed ? AGENT_PIPELINE.indexOf("enforcing") + 1 : AGENT_PIPELINE.indexOf(state);
  const steps = closed ? [...AGENT_PIPELINE.slice(0, -1), "closed" as AgentState] : AGENT_PIPELINE;
  return (
    <div className={cn("w-full", className)}>
      <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const done = idx > i || (closed && i === steps.length - 1) || (state === "monitoring" && s === "monitoring");
          const current = !closed && i === idx;
          return (
            <li key={s} className="min-w-0" title={AGENT_STATE_HINT[s]}>
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  done ? "bg-agent" : current ? "bg-agent/50 animate-pulse-dot" : "bg-muted",
                  escalated && current && "bg-blocked",
                )}
              />
              <div
                className={cn(
                  "mt-1.5 truncate text-[10.5px]",
                  current ? "font-medium text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/60",
                )}
              >
                {AGENT_STATE_LABEL[s]}
              </div>
            </li>
          );
        })}
      </ol>
      {escalated && <div className="mt-2 text-xs font-medium text-blocked">Escalated: the agent needs a human to proceed.</div>}
    </div>
  );
}
