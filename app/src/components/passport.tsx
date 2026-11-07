"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { ExternalLinkIcon, FileBadgeIcon, KeyRoundIcon, QrCodeIcon } from "lucide-react";
import type { PartPassport, VerifyResult } from "@/contracts";
import { countryName, formatDate, formatPct, formatUsd, truncateMiddle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePublicBaseUrl } from "@/components/public-url";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** QR code pointing at the public verify page for a passport. Renders client-side only. */
export function PassportQr({
  passportId,
  size = 112,
  className,
  presenterLink = false,
}: {
  passportId: string;
  size?: number;
  className?: string;
  /** In-app link opens the verify page with presenter (tamper demo) controls. The QR itself never does. */
  presenterLink?: boolean;
}) {
  const base = usePublicBaseUrl();
  const target = base ? `${base}/verify/${encodeURIComponent(passportId)}` : null;
  const [qr, setQr] = useState<{ target: string; src: string }>();
  useEffect(() => {
    if (!target) return;
    let active = true;
    QRCode.toDataURL(target, { margin: 1, width: size * 2, color: { dark: "#111827", light: "#ffffff" } }).then((src) => {
      if (active) setQr({ target, src });
    });
    return () => {
      active = false;
    };
  }, [target, size]);
  const src = qr && qr.target === target ? qr.src : undefined;
  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)}>
      <div className="rounded-lg border bg-white p-1.5 shadow-sm" style={{ width: size + 14, height: size + 14 }} title={target ?? undefined}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL generated in the browser
          <img src={src} alt={`QR code for passport ${passportId}`} width={size} height={size} />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <QrCodeIcon className="size-6" />
          </div>
        )}
      </div>
      {src && (
        <Link
          href={`/verify/${encodeURIComponent(passportId)}${presenterLink ? "?presenter=1" : ""}`}
          className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline">
          Scan target <ExternalLinkIcon className="size-3" />
        </Link>
      )}
    </div>
  );
}

export function DomesticContentBar({ ratio, threshold }: { ratio: number; threshold?: number }) {
  const ok = threshold === undefined || ratio >= threshold;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">Domestic content (US share of component cost)</span>
        <span className={cn("font-semibold tabular", ok ? "text-approved" : "text-blocked")}>{formatPct(ratio, 1)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-muted">
        <div className={cn("h-full rounded-full", ok ? "bg-approved" : "bg-blocked")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        {threshold !== undefined && (
          <div className="absolute -top-1 -bottom-1 w-0.5 bg-foreground/70" style={{ left: `${threshold * 100}%` }} title={`Policy threshold ${formatPct(threshold)}`} />
        )}
      </div>
      {threshold !== undefined && (
        <div className="text-[11px] text-muted-foreground">Policy threshold {formatPct(threshold)} (Buy American, through 2028)</div>
      )}
    </div>
  );
}

/** Paths (e.g. "components.2.countryOfOrigin") whose presented value differs from what was signed. */
export type ChangedPaths = Set<string>;

const EDITED = "bg-blocked/10 ring-1 ring-blocked/50 rounded px-1 -mx-1";

export function ComponentsTable({
  passport,
  restricted = [],
  changed,
}: {
  passport: Pick<PartPassport, "components" | "totalCostUsd">;
  restricted?: string[];
  changed?: ChangedPaths;
}) {
  const ed = (i: number, f: string) => (changed?.has(`components.${i}.${f}`) ? EDITED : "");
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Component</TableHead>
          <TableHead>Sub-tier supplier</TableHead>
          <TableHead>Origin</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead className="text-right">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {passport.components.map((c, i) => {
          const bad = restricted.includes(c.countryOfOrigin);
          return (
            <TableRow key={i} className={cn(bad && "bg-blocked/5")}>
              <TableCell>
                <div className={cn("font-medium", ed(i, "name"))}>{c.name}</div>
                {c.partNumber && <div className="font-mono text-[11px] text-muted-foreground">{c.partNumber}</div>}
              </TableCell>
              <TableCell className="text-muted-foreground">
                <span className={ed(i, "supplierName")}>{c.supplierName}</span>
              </TableCell>
              <TableCell>
                <span className={cn("inline-flex items-center gap-1.5", bad && "font-medium text-blocked", ed(i, "countryOfOrigin"))}>
                  <span className="font-mono text-[11px]">{c.countryOfOrigin}</span>
                  <span className="text-muted-foreground">{countryName(c.countryOfOrigin)}</span>
                  {bad && <span className="rounded border border-blocked/30 px-1 text-[10px] uppercase">restricted</span>}
                </span>
              </TableCell>
              <TableCell className="text-right tabular">
                <span className={ed(i, "costUsd")}>{formatUsd(c.costUsd)}</span>
              </TableCell>
              <TableCell className="text-right tabular text-muted-foreground">
                {passport.totalCostUsd ? formatPct(c.costUsd / passport.totalCostUsd) : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Full passport view: claims, components with origin, domestic content, certs, signature + QR. */
export function PassportCard({
  passport,
  threshold,
  restricted,
  verify,
  actions,
  className,
  showQr = true,
  changed,
}: {
  changed?: ChangedPaths;
  passport: Omit<PartPassport, "jwt"> & { jwt?: string };
  showQr?: boolean;
  threshold?: number;
  restricted?: string[];
  verify?: VerifyResult | null;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-card", className)}>
      <div className="flex flex-wrap items-start gap-4 border-b p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <FileBadgeIcon className="size-4 text-brand" />
            <span className="text-[13px] font-semibold">{passport.model}</span>
            <span className="rounded-md border px-1.5 text-[11px] text-muted-foreground">v{passport.version}</span>
            {passport.revoked && <span className="rounded-md border border-blocked/30 bg-blocked/10 px-1.5 text-[11px] font-medium text-blocked">Revoked</span>}
          </div>
          <div className="text-xs text-muted-foreground">{passport.spec}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[11px] text-muted-foreground">
            <span>
              Batch <span className={cn("font-mono text-foreground/80", changed?.has("serialOrBatch") && EDITED)}>{passport.serialOrBatch}</span>
            </span>
            <span>
              Passport <span className="font-mono text-foreground/80">{passport.id}</span>
            </span>
            {passport.prevVersionId && (
              <span>
                Supersedes <span className="font-mono text-foreground/80">{passport.prevVersionId}</span>
              </span>
            )}
            {passport.firmwareVersion && <span>Firmware {passport.firmwareVersion}</span>}
            <span>Issued {formatDate(passport.issuedAt)}</span>
            <span>Expires {formatDate(passport.expiresAt)}</span>
            <span>Status index #{passport.statusIndex}</span>
          </div>
          <div className="pt-1 text-[11px] text-muted-foreground">
            Facility: {passport.facility.line1}, {passport.facility.city}, {passport.facility.state} {passport.facility.zip}
          </div>
        </div>
        {showQr && <PassportQr passportId={passport.id} size={96} presenterLink />}
      </div>
      <div className={cn("p-4", changed?.has("domesticContentRatio") && "bg-blocked/5 ring-1 ring-inset ring-blocked/40")}>
        <DomesticContentBar ratio={passport.domesticContentRatio} threshold={threshold} />
      </div>
      <div className="border-t">
        <ComponentsTable passport={passport} restricted={restricted} changed={changed} />
      </div>
      <div className="grid gap-4 border-t p-4 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-medium">Test certificates</div>
          {passport.testCertificates.length === 0 ? (
            <div className="text-xs text-muted-foreground">None attached.</div>
          ) : (
            <ul className="space-y-1.5">
              {passport.testCertificates.map((c) => (
                <li key={c.certNumber + c.fileSha256} className="text-xs">
                  <span className="font-mono font-medium">{c.certNumber}</span> <span className="text-muted-foreground">· {c.issuer}</span>
                  <div className="font-mono text-[10.5px] text-muted-foreground" title={c.fileSha256}>
                    sha256 {truncateMiddle(c.fileSha256, 16, 8)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
            <KeyRoundIcon className="size-3.5" /> Signature (Ed25519 VC-JWT)
          </div>
          {passport.jwt ? (
            <div className="font-mono text-[10.5px] break-all text-muted-foreground" title={passport.jwt}>
              {truncateMiddle(passport.jwt, 48, 24)}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Signature verified from the presented credential.</div>
          )}
          {verify && (
            <div className={cn("mt-1.5 text-xs font-medium", verify.valid ? "text-approved" : "text-blocked")}>
              {verify.valid ? "Signature valid" : `Signature invalid (${verify.reason ?? "unknown"})`}
            </div>
          )}
          {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
