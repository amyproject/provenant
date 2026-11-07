"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FlaskConicalIcon, RotateCcwIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldQuestionIcon } from "lucide-react";
import type { PartPassport, VerifyResult } from "@/contracts";
import { api, ApiClientError, DEMO_TOKEN_KEY, errorMessage } from "@/lib/client/api";
import { invalidateAll, useApi } from "@/lib/client/hooks";
import { countryName, formatDateTime, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingRows } from "@/components/page";
import { PassportCard, PassportQr } from "@/components/passport";
import { Brand } from "@/components/app-shell";

const REASON_TEXT: Record<NonNullable<VerifyResult["reason"]>, string> = {
  bad_signature: "The claims were altered after signing. The Ed25519 signature no longer matches the content.",
  expired: "The passport is past its expiry date.",
  revoked: "The issuer revoked this passport (Bitstring Status List bit is set).",
  unknown_issuer: "The signing key does not belong to a known issuer.",
  malformed: "The credential is not a well-formed VC-JWT.",
  not_found: "No passport with this ID exists.",
};

interface Tamper {
  label: string;
  path: string;
  value: unknown;
  describe: (p: Omit<PartPassport, "jwt">) => string;
}

function tamperOptions(p: Omit<PartPassport, "jwt">): Tamper[] {
  const foreign = p.components.findIndex((c) => c.countryOfOrigin !== "US");
  const idx = foreign === -1 ? 0 : foreign;
  const comp = p.components[idx];
  const newCountry = foreign === -1 ? "CN" : "US";
  return [
    {
      label: foreign === -1 ? "Move a component offshore" : "Relabel a foreign component as US-made",
      path: `components.${idx}.countryOfOrigin`,
      value: newCountry,
      describe: () => `${comp?.name ?? "Component"} origin: ${comp?.countryOfOrigin ?? "?"} → ${newCountry}`,
    },
    {
      label: "Inflate domestic content",
      path: "domesticContentRatio",
      value: 0.99,
      describe: (x) => `Domestic content: ${formatPct(x.domesticContentRatio)} → 99%`,
    },
    {
      label: "Reuse for another batch",
      path: "serialOrBatch",
      value: `${p.serialOrBatch.replace(/\d+$/, "")}9999`,
      describe: (x) => `Batch: ${x.serialOrBatch} → ${x.serialOrBatch.replace(/\d+$/, "")}9999`,
    },
  ];
}

function Verdict({ result }: { result: VerifyResult }) {
  const ok = result.valid;
  const Icon = ok ? ShieldCheckIcon : result.reason === "not_found" ? ShieldQuestionIcon : ShieldAlertIcon;
  return (
    <div
      className={cn(
        "flex items-start gap-4 rounded-2xl border p-5",
        ok ? "border-approved/30 bg-approved/[0.07]" : "border-blocked/40 bg-blocked/[0.08]",
      )}
    >
      <div className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm", ok ? "bg-approved" : "bg-blocked")}>
        <Icon className="size-6" />
      </div>
      <div className="min-w-0">
        <div className={cn("text-2xl font-semibold tracking-tight", ok ? "text-approved" : "text-blocked")}>
          {ok ? "Signature valid" : result.reason === "revoked" ? "PASSPORT REVOKED" : result.reason === "not_found" ? "Passport not found" : "SIGNATURE INVALID"}
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {ok
            ? `These claims were signed by ${result.issuer?.legalName ?? "the issuer"} and have not been altered. The passport is not revoked or expired.`
            : REASON_TEXT[result.reason ?? "malformed"]}
        </p>
        {result.issuer && (
          <p className="mt-1 text-xs text-muted-foreground">
            Issuer: <span className="font-medium text-foreground">{result.issuer.legalName}</span>{" "}
            <span className="font-mono">({result.issuer.supplierId})</span>
          </p>
        )}
      </div>
    </div>
  );
}

const noopSubscribe = () => () => {};

/** Presenter controls (tamper/restore) show only with ?presenter=1 or a demo token stored in this browser. */
function isPresenter(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("presenter") === "1" || !!window.localStorage.getItem(DEMO_TOKEN_KEY);
  } catch {
    return false;
  }
}

export function VerifyPassportView({ passportId }: { passportId: string }) {
  const presenter = useSyncExternalStore(noopSubscribe, isPresenter, () => false);
  const passport = useApi(`passport:${passportId}`, () => api.getPassport(passportId));
  const jwt = passport.data?.jwt;
  const verify = useApi(jwt ? `verify:${jwt}` : null, () => api.verify(jwt!));
  const [lastTamper, setLastTamper] = useState<{ description: string; at: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Result of verifying the tampered JWT directly; shown while the stored passport is refetched.
  const [tamperResult, setTamperResult] = useState<VerifyResult | null>(null);

  const notFound = passport.error instanceof ApiClientError && passport.error.status === 404;
  const result: VerifyResult | undefined = notFound
    ? { valid: false, revoked: false, reason: "not_found" }
    : (verify.data ?? tamperResult ?? undefined);
  const stored = passport.data ? stripJwt(passport.data) : undefined;
  // What the JWT actually claims (decoded even when the signature fails) laid over the stored record.
  const presented = presentedClaims(result, stored);
  const shown = presented ?? result?.passport ?? stored;
  // The stored record keeps the originally signed values; the JWT may carry edited ones.
  const diffs = presented && stored && result && !result.valid ? diffClaims(pickClaims(stored), pickClaims(presented)) : [];
  const changed = new Set(diffs.map((d) => d.path));

  const tamper = async (t: Tamper) => {
    if (!shown) return;
    setBusy(t.path);
    try {
      const description = t.describe(shown);
      const res = await api.tamper({ passportId, path: t.path, value: t.value });
      const v = await api.verify(res.tamperedJwt);
      setLastTamper({ description, at: new Date().toISOString() });
      setTamperResult(v);
      invalidateAll();
      if (v.valid) toast.warning("Tamper did not break the signature (unexpected)");
      else toast.error("Signature invalid", { description: `${description}. Verification failed: ${v.reason}.` });
    } catch (e) {
      toast.error("Tamper demo failed", { description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy("reset");
    try {
      await api.restorePassport(passportId);
      setLastTamper(null);
      setTamperResult(null);
      invalidateAll();
      toast.success("Original restored", { description: "The passport carries its issuer-signed JWT again." });
    } catch (e) {
      toast.error("Reset failed", { description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-svh bg-canvas">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Brand />
          <span className="text-xs text-muted-foreground">Public passport verification</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Part passport</div>
            <h1 className="font-mono text-lg font-semibold">{passportId}</h1>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              The QR code on the part carries this reference. The tag is not the proof: the proof is the issuer&apos;s Ed25519 signature over
              the claims below, checked against the issuer&apos;s public key.
            </p>
          </div>
          <PassportQr passportId={passportId} size={88} />
        </div>

        {passport.error && !notFound ? (
          <ErrorState error={passport.error} onRetry={passport.refresh} />
        ) : !result ? (
          <LoadingRows rows={4} className="p-0" />
        ) : (
          <Verdict result={result} />
        )}

        {result && !result.valid && (diffs.length > 0 || lastTamper) && (
          <div className="overflow-hidden rounded-xl border border-blocked/30 bg-background">
            <div className="border-b border-blocked/20 bg-blocked/5 px-4 py-2 text-[13px] font-medium text-blocked">
              {diffs.length > 0 ? `${diffs.length} claim${diffs.length === 1 ? "" : "s"} edited after signing` : "Claim edited after signing"}
            </div>
            {diffs.length > 0 ? (
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-4 py-1.5 text-left font-medium">Claim</th>
                    <th className="px-4 py-1.5 text-left font-medium">Signed by issuer</th>
                    <th className="px-4 py-1.5 text-left font-medium">Presented now</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {diffs.map((d) => (
                    <tr key={d.path}>
                      <td className="px-4 py-1.5 font-mono">{d.path}</td>
                      <td className="px-4 py-1.5 font-mono text-muted-foreground line-through">{fmtValue(d.signed)}</td>
                      <td className="px-4 py-1.5 font-mono font-semibold text-blocked">{fmtValue(d.presented)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-4 py-2 text-xs">{lastTamper?.description}</div>
            )}
            <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
              The edit was made without the issuer&apos;s private key, so the Ed25519 signature no longer matches.
              {lastTamper && ` Altered at ${formatDateTime(lastTamper.at)}.`}
            </div>
          </div>
        )}

        {shown && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Fact label="Model" value={shown.model} edited={changed.has("model")} />
              <Fact label="Batch / serial" value={shown.serialOrBatch} mono edited={changed.has("serialOrBatch")} />
              <Fact
                label="Facility"
                value={`${shown.facility.city}, ${shown.facility.state}, ${countryName(shown.facility.country)}`}
              />
            </div>
            <PassportCard passport={{ ...shown, jwt: passport.data?.jwt }} verify={result} showQr={false} changed={changed} />
          </>
        )}

        {shown && presenter && (
          <section className="rounded-xl border border-dashed border-blocked/40 bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[13px] font-semibold">
                  <FlaskConicalIcon className="size-4 text-blocked" /> Tamper demo
                </div>
                <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
                  Edit one claim inside the signed passport without re-signing (POST /api/demo/tamper), then verify again. Any change breaks
                  the signature. Demo only; Restore puts the signed original back.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={restore} disabled={!!busy}>
                <RotateCcwIcon className={busy === "reset" ? "animate-spin" : ""} /> Restore original
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {tamperOptions(shown).map((t) => (
                <Button key={t.path} variant="destructive" size="sm" onClick={() => tamper(t)} disabled={!!busy}>
                  {busy === t.path ? "Tampering…" : t.label}
                </Button>
              ))}
            </div>
          </section>
        )}

        {result?.claims && (
          <details className="rounded-xl border bg-background">
            <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium">Decoded JWT claims (shown even when the signature fails)</summary>
            <pre className="max-h-96 overflow-auto border-t px-4 py-3 font-mono text-[11px] leading-4 whitespace-pre-wrap">
              {JSON.stringify(result.claims, null, 2)}
            </pre>
          </details>
        )}

        <footer className="pt-4 text-center text-[11px] text-muted-foreground">
          Verified by Provenant · W3C Verifiable Credentials 2.0 · Ed25519 ·{" "}
          <Link href="/" className="hover:text-foreground">
            Buyer console
          </Link>
        </footer>
      </main>
    </div>
  );
}

/** Passport claim fields that appear in the VC credentialSubject; used for display and diffing. */
const CLAIM_KEYS = [
  "version",
  "facility",
  "serialOrBatch",
  "model",
  "spec",
  "components",
  "totalCostUsd",
  "domesticContentRatio",
  "testCertificates",
  "firmwareVersion",
  "issuedAt",
  "expiresAt",
] as const;

function pickClaims(p: Omit<PartPassport, "jwt">): Record<string, unknown> {
  return Object.fromEntries(CLAIM_KEYS.map((k) => [k, p[k]]));
}

function presentedClaims(result: VerifyResult | undefined, stored: Omit<PartPassport, "jwt"> | undefined): Omit<PartPassport, "jwt"> | undefined {
  const claims = result?.claims;
  if (!claims) return undefined;
  const vc = claims.vc as { credentialSubject?: unknown } | undefined;
  const subject = (claims.credentialSubject ?? vc?.credentialSubject) as Record<string, unknown> | undefined;
  if (!subject || typeof subject !== "object") return undefined;
  const base = stored ?? result?.passport;
  if (!base) return undefined;
  const picked = Object.fromEntries(CLAIM_KEYS.filter((k) => k in subject).map((k) => [k, subject[k]]));
  return { ...base, ...picked } as Omit<PartPassport, "jwt">;
}

interface ClaimDiff {
  path: string;
  signed: unknown;
  presented: unknown;
}

/** Leaf-level differences between the stored (signed) passport and the claims presented in the JWT. */
function diffClaims(signed: unknown, presented: unknown, path = ""): ClaimDiff[] {
  if (["jwt", "revoked"].includes(path)) return [];
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
  if (isObj(signed) && isObj(presented)) {
    const keys = new Set([...Object.keys(signed), ...Object.keys(presented)]);
    return [...keys].flatMap((k) => diffClaims(signed[k], presented[k], path ? `${path}.${k}` : k));
  }
  return JSON.stringify(signed) === JSON.stringify(presented) ? [] : [{ path, signed, presented }];
}

function fmtValue(v: unknown): string {
  if (v === undefined) return "(absent)";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function stripJwt(p: PartPassport): Omit<PartPassport, "jwt"> {
  const { jwt: _jwt, ...rest } = p;
  void _jwt;
  return rest;
}

function Fact({ label, value, mono, edited }: { label: string; value: string; mono?: boolean; edited?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-card px-4 py-3", edited && "border-blocked/50 bg-blocked/5")}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 truncate text-[13px] font-medium", mono && "font-mono")}>{value}</div>
    </div>
  );
}
