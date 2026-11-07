import type { Address } from "@/contracts";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export function formatUsd(n: number, cents = false): string {
  return (cents ? usdCents : usd).format(n);
}

export function formatPct(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatRelative(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const s = Math.round((now - t) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

export function countryName(code: string): string {
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function formatAddress(a: Address): string {
  return `${a.line1}, ${a.city}, ${a.state} ${a.zip}, ${a.country}`;
}

export function shortId(id: string, n = 8): string {
  return id.length > n + 3 ? `${id.slice(0, n)}…` : id;
}

export function truncateMiddle(s: string, head = 18, tail = 10): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

export function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Human label for a purchase order id: "po_1001" -> "PO-1001"; uuids are shortened. */
export function poLabel(id: string): string {
  const m = /^po[_-]?(.+)$/i.exec(id);
  const core = m ? m[1] : id;
  return `PO-${(core.length > 10 ? core.slice(0, 8) : core).toUpperCase()}`;
}

/** Countdown to a future timestamp: "in 12s", "in 4m", or "due" once passed. */
export function formatIn(iso: string, now = Date.now()): string {
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  if (Number.isNaN(s) || s <= 0) return "due";
  if (s < 60) return `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  return `in ${Math.round(m / 60)}h`;
}
