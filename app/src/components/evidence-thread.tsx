"use client";

import { useState } from "react";
import { Building2Icon, MailIcon, PaperclipIcon, SendIcon } from "lucide-react";
import type { AgentEvent, OutboundMessage } from "@/contracts";
import { formatDateTime } from "@/lib/format";
import { api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";
import { ProviderBadge } from "@/components/status";
import { EmptyState } from "@/components/page";

type Item = { kind: "out"; at: string; msg: OutboundMessage } | { kind: "in"; at: string; ev: AgentEvent };

function attachmentsOf(ev: AgentEvent): string[] {
  const raw = ev.detail?.attachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => (typeof a === "string" ? a : typeof a === "object" && a && "filename" in a ? String((a as { filename: unknown }).filename) : ""))
    .filter(Boolean);
}

function Outbound({ msg }: { msg: OutboundMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-8 flex justify-end">
      <div className="w-full max-w-[92%] rounded-xl rounded-tr-sm border border-agent/25 bg-agent/[0.05] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <SendIcon className="size-3 text-agent" />
          <span className="font-medium text-foreground/80">Agent → {msg.to}</span>
          <ProviderBadge provider={msg.provider} />
          <span className="ml-auto tabular">{formatDateTime(msg.sentAt)}</span>
        </div>
        <div className="mt-1 text-[13px] font-medium">{msg.subject}</div>
        <div className={cn("mt-1 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/80", !open && "line-clamp-4")}>{msg.body}</div>
        <button onClick={() => setOpen((o) => !o)} className="mt-1 text-[11px] text-muted-foreground hover:text-foreground">
          {open ? "Collapse" : "Full email"}
        </button>
      </div>
    </div>
  );
}

function Inbound({ ev, stub }: { ev: AgentEvent; stub: boolean }) {
  const files = attachmentsOf(ev);
  return (
    <div className="mr-8 flex">
      <div className="w-full max-w-[92%] rounded-xl rounded-tl-sm border bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Building2Icon className="size-3 text-brand" />
          <span className="font-medium text-foreground/80">Supplier reply</span>
          <span
            className={
              stub
                ? "rounded border border-dashed border-quarantined/50 px-1 text-[10px] text-[color-mix(in_oklch,var(--quarantined),black_25%)]"
                : "rounded border border-brand/25 px-1 text-[10px] text-brand"
            }
            title={stub ? "Simulated supplier reply from the Naive stub adapter (no live Naive token yet)" : undefined}
          >
            {stub ? "received via Naive (stub)" : "received via Naive"}
          </span>
          <span className="ml-auto tabular">{formatDateTime(ev.at)}</span>
        </div>
        <div className="mt-1 text-[13px]">{ev.summary}</div>
        {typeof ev.detail?.body === "string" && (
          <div className="mt-1.5 rounded-md border bg-muted/30 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/85">
            {ev.detail.body}
          </div>
        )}
        {files.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {files.map((f) => (
              <span key={f} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">
                <PaperclipIcon className="size-3" /> {f}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The agent's email exchange with a supplier: outbound requests (outbox) interleaved with the
 * supplier's replies (agent events with actor "supplier"), oldest first.
 */
export function EvidenceThread({ messages, events, className }: { messages: OutboundMessage[]; events: AgentEvent[]; className?: string }) {
  const integrations = useApi("integrations", () => api.integrationStatus(), 30_000);
  // Replies are only real Naive traffic when the live adapter is on; until then they come from the stub.
  const stub = integrations.data ? integrations.data.naive !== "live" : true;
  const items: Item[] = [
    ...messages.map((msg) => ({ kind: "out" as const, at: msg.sentAt, msg })),
    ...events.filter((e) => e.actor === "supplier").map((ev) => ({ kind: "in" as const, at: ev.at, ev })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  if (items.length === 0) {
    return (
      <EmptyState title="No supplier exchange yet" icon={<MailIcon />}>
        When evidence is missing, the agent emails the supplier through Naive and ingests the reply. The thread appears here.
      </EmptyState>
    );
  }
  return (
    <div className={cn("space-y-2.5 p-3", className)}>
      {items.map((it) => (it.kind === "out" ? <Outbound key={it.msg.id} msg={it.msg} /> : <Inbound key={it.ev.id} ev={it.ev} stub={stub} />))}
    </div>
  );
}
