import { cn } from "@/lib/utils";
import { humanize } from "@/lib/format";

function isFlat(v: unknown): v is Record<string, string | number | boolean | null> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => x === null || ["string", "number", "boolean"].includes(typeof x))
  );
}

/** One-line rendering of nested evidence: `from (supplierName: X · countryOfOrigin: US)`. */
function inline(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return v.map(inline).join("; ");
  return Object.entries(v)
    .map(([k, x]) => (typeof x === "object" && x !== null && !Array.isArray(x) ? `${k} (${inline(x)})` : `${k}: ${inline(x)}`))
    .join(" · ");
}

function renderValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof v === "boolean") return <span className="font-medium">{v ? "yes" : "no"}</span>;
  if (typeof v === "number") return <span className="tabular">{v}</span>;
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every((x) => typeof x !== "object" || x === null)) return v.join(", ");
  if (isFlat(v)) {
    return (
      <span className="inline-flex flex-wrap gap-x-2">
        {Object.entries(v).map(([k, x]) => (
          <span key={k}>
            <span className="text-muted-foreground">{k}:</span> {x === null || x === undefined ? "—" : String(x)}
          </span>
        ))}
      </span>
    );
  }
  if (Array.isArray(v)) {
    return (
      <ul className="space-y-1">
        {v.map((x, i) => (
          <li key={i} className="rounded bg-muted/50 px-1.5 py-1">
            {inline(x)}
          </li>
        ))}
      </ul>
    );
  }
  return <span>{inline(v)}</span>;
}

/** Key/value rendering of an evidence record (flag evidence, check evidence, extracted fields). */
export function EvidenceView({ data, className }: { data: Record<string, unknown> | undefined; className?: string }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) return <div className={cn("text-xs text-muted-foreground", className)}>No evidence recorded.</div>;
  return (
    <dl className={cn("grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs", className)}>
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="whitespace-nowrap text-muted-foreground">{humanize(k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase())}</dt>
          <dd className="min-w-0 break-words text-foreground">{renderValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
