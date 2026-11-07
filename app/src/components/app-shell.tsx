"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BotIcon, FactoryIcon, FileCheck2Icon, LayoutDashboardIcon, Settings2Icon, ShieldCheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { USE_MOCKS, api } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { AutopilotToggle } from "@/components/autopilot";

const NAV = [
  { href: "/", label: "Command center", Icon: LayoutDashboardIcon },
  { href: "/purchase-orders", label: "Purchase orders", Icon: FileCheck2Icon },
  { href: "/agent", label: "Agent operations", Icon: BotIcon },
  { href: "/suppliers", label: "Suppliers", Icon: FactoryIcon },
  { href: "/settings", label: "Settings", Icon: Settings2Icon },
];

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <ShieldCheckIcon className="size-4" />
      </div>
      <div className="leading-tight">
        <div className="text-[13px] font-semibold tracking-tight">Provenant</div>
        <div className="text-[10.5px] text-muted-foreground">Verified US supply chains</div>
      </div>
    </div>
  );
}

export function SidebarNav() {
  const pathname = usePathname();
  return <NavList isActive={(href) => (href === "/" ? pathname === "/" : pathname.startsWith(href))} />;
}

export function SidebarNavFallback() {
  return <NavList isActive={() => false} />;
}

function NavList({ isActive }: { isActive: (href: string) => boolean }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
              active
                ? "bg-background font-medium text-foreground shadow-[0_0_0_1px_var(--border),0_1px_2px_rgba(16,24,40,0.05)]"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )}
          >
            <Icon className={cn("size-4", active ? "text-brand" : "")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function IntegrationFooter() {
  const { data } = useApi("integrations", () => api.integrationStatus(), 30_000);
  const rows: { label: string; on: boolean; text: string }[] = data
    ? [
        { label: "Naive", on: data.naive === "live", text: data.naive === "live_pending" ? "key set · stub" : data.naive },
        { label: "Claude", on: data.anthropic === "live", text: data.anthropic },
        { label: "SAM.gov", on: data.samGov === "live", text: data.samGov },
        { label: "Storage", on: data.storage !== "memory", text: data.storage },
      ]
    : [];
  return (
    <Link href="/settings" className="block rounded-lg border bg-background/70 p-2.5 text-[11px] hover:bg-background">
      <div className="mb-1.5 font-medium text-foreground">Integrations</div>
      {rows.length === 0 ? (
        <div className="text-muted-foreground">Checking…</div>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className={cn("size-1.5 rounded-full", r.on ? "bg-approved" : "bg-quarantined")} />
                {r.label}
              </span>
              <span className="font-mono text-[10.5px]">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}

export function Sidebar({ nav }: { nav: React.ReactNode }) {
  return (
    <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-6 border-r bg-sidebar px-3 py-4 md:flex">
      <Brand className="px-1.5" />
      {nav}
      <div className="mt-auto space-y-2">
        {USE_MOCKS && (
          <div className="rounded-lg border border-dashed border-quarantined/50 bg-quarantined/8 px-2.5 py-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Mock data mode.</span> NEXT_PUBLIC_USE_MOCKS=1 — the browser is
            simulating the backend.
          </div>
        )}
        <IntegrationFooter />
      </div>
    </aside>
  );
}

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b bg-background/85 px-4 backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Brand className="md:hidden" />
        <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
          <span className="rounded-md border bg-muted/60 px-1.5 py-0.5 font-medium text-foreground">Corvid Robotics</span>
          <span>Buyer workspace · demo tenant</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <AutopilotToggle />
      </div>
    </header>
  );
}

/** Compact horizontal nav for small screens. */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b bg-background px-3 py-1.5 md:hidden">
      {NAV.map(({ href, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn("shrink-0 rounded-md px-2 py-1 text-xs", active ? "bg-muted font-medium" : "text-muted-foreground")}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
