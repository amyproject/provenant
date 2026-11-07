import { AlertCircleIcon, InboxIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4 pb-5", className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow && <div className="text-xs font-medium text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="max-w-3xl text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
        {icon ?? <InboxIcon />}
      </div>
      <div className="text-[13px] font-medium">{title}</div>
      {children && <div className="max-w-sm text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-blocked/25 bg-blocked/5 px-4 py-3 text-[13px]">
      <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-blocked" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-blocked">Could not load data</div>
        <div className="break-words text-xs text-muted-foreground">{error.message}</div>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-medium text-foreground underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 p-4", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function KeyValue({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,38%)_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words text-foreground", mono && "font-mono text-xs")}>{children}</dd>
    </div>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12px] text-muted-foreground", className)}>{children}</span>;
}
