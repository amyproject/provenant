"use client";

import { useState } from "react";
import Link from "next/link";
import { MailIcon } from "lucide-react";
import type { OutboundMessage } from "@/contracts";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProviderBadge } from "@/components/status";
import { EmptyState } from "@/components/page";

export function MessageCard({ message, caseHref, caseLabel }: { message: OutboundMessage; caseHref?: string; caseLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
          <MailIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[13px] font-medium">{message.subject}</span>
            <ProviderBadge provider={message.provider} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span>
              to <span className="font-mono text-foreground/80">{message.to}</span>
            </span>
            <span>·</span>
            <span className="tabular">{formatDateTime(message.sentAt)}</span>
            {caseHref && (
              <>
                <span>·</span>
                <Link href={caseHref} className="font-mono text-brand hover:underline">
                  {caseLabel ?? message.caseId}
                </Link>
              </>
            )}
            {message.providerMessageId && (
              <>
                <span>·</span>
                <span className="font-mono" title="Provider message id">
                  {message.providerMessageId}
                </span>
              </>
            )}
          </div>
          <div
            className={cn(
              "mt-2 rounded-md border bg-muted/30 px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/85",
              !open && "line-clamp-3",
            )}
          >
            {message.body}
          </div>
          <button onClick={() => setOpen((o) => !o)} className="mt-1 text-[11px] text-muted-foreground hover:text-foreground">
            {open ? "Collapse" : "Show full email"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function OutboxList({
  messages,
  caseLink,
  emptyHint,
}: {
  messages: OutboundMessage[];
  caseLink?: (m: OutboundMessage) => { href: string; label: string } | undefined;
  emptyHint?: string;
}) {
  if (messages.length === 0) {
    return (
      <EmptyState title="No outbound messages" icon={<MailIcon />}>
        {emptyHint ?? "When the agent needs evidence it emails the supplier through Naive. Messages appear here."}
      </EmptyState>
    );
  }
  const sorted = [...messages].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  return (
    <div className="divide-y">
      {sorted.map((m) => {
        const link = caseLink?.(m);
        return <MessageCard key={m.id} message={m} caseHref={link?.href} caseLabel={link?.label} />;
      })}
    </div>
  );
}
