"use client";

import { Fragment, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRightIcon, ExternalLinkIcon, KeyRoundIcon, UploadIcon } from "lucide-react";
import type { EvidenceDocument, EvidenceKind, IdentityCheckResult } from "@/contracts";
import { api, errorMessage } from "@/lib/client/api";
import { invalidateAll, useApi } from "@/lib/client/hooks";
import { EVIDENCE_KIND_LABEL, IDENTITY_CHECK_LABEL } from "@/lib/domain-meta";
import { formatAddress, formatDate, formatDateTime, truncateMiddle } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, KeyValue, LoadingRows, Panel } from "@/components/page";
import { EvidenceView } from "@/components/evidence-view";
import { CheckStatusBadge, CheckStatusIcon } from "@/components/status";
import { PassportCard } from "@/components/passport";
import { Field, NativeSelect } from "@/components/form";
import { CredentialBadge } from "@/components/views/suppliers";

function CheckRow({ check }: { check: IdentityCheckResult }) {
  const [open, setOpen] = useState(check.status === "flag");
  const meta = IDENTITY_CHECK_LABEL[check.kind];
  return (
    <div className={cn("px-4 py-2.5", check.status === "flag" && "bg-blocked/[0.03]")}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 text-left">
        <CheckStatusIcon status={check.status} />
        <span className="text-[13px] font-medium">{meta.title}</span>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">{meta.source}</span>
        <span className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              "rounded border px-1 font-mono text-[10px] uppercase",
              check.source === "live" ? "border-approved/30 text-approved" : "text-muted-foreground",
            )}
            title={check.source === "live" ? "Live API call" : "Fixture data (no API key configured)"}
          >
            {check.source}
          </span>
          <CheckStatusBadge status={check.status} />
          <ChevronRightIcon className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        </span>
      </button>
      {open && (
        <div className="mt-2 pl-6">
          <EvidenceView data={check.evidence} className="rounded-md border bg-background p-2" />
          <div className="mt-1 text-[10.5px] text-muted-foreground">Checked {formatDateTime(check.checkedAt)}</div>
        </div>
      )}
    </div>
  );
}

function DocumentsTable({ docs }: { docs: EvidenceDocument[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (docs.length === 0) return <div className="px-4 py-6 text-center text-xs text-muted-foreground">No documents on file.</div>;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-4">Document</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>SHA-256</TableHead>
          <TableHead>Received via</TableHead>
          <TableHead className="pr-4">Received</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {docs.map((d) => (
          <Fragment key={d.id}>
            <TableRow className="cursor-pointer" onClick={() => setOpenId(openId === d.id ? null : d.id)}>
              <TableCell className="pl-4">
                <span className="flex items-center gap-1.5">
                  <ChevronRightIcon className={cn("size-3 text-muted-foreground transition-transform", openId === d.id && "rotate-90")} />
                  <span className="font-mono text-xs">{d.filename}</span>
                </span>
              </TableCell>
              <TableCell>{EVIDENCE_KIND_LABEL[d.kind]}</TableCell>
              <TableCell className="font-mono text-[11px] text-muted-foreground" title={d.sha256}>
                {truncateMiddle(d.sha256, 10, 6)}
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    "rounded border px-1.5 text-[11px]",
                    d.receivedVia === "naive_inbox" ? "border-brand/25 text-brand" : "text-muted-foreground",
                  )}
                >
                  {d.receivedVia === "naive_inbox" ? "Naive inbox (agent)" : d.receivedVia === "upload" ? "Manual upload" : "Seed"}
                </span>
              </TableCell>
              <TableCell className="pr-4 text-muted-foreground">{formatDateTime(d.receivedAt)}</TableCell>
            </TableRow>
            {openId === d.id && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="bg-muted/20 px-4 py-3 whitespace-normal">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs font-medium">Extracted fields</div>
                      <EvidenceView data={d.extracted} />
                    </div>
                    <div>
                      <div className="mb-1 text-xs font-medium">File metadata</div>
                      <EvidenceView data={d.metadata} />
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error ?? new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

/** POST /api/suppliers/:id/documents with the file as base64 JSON; the backend extracts fields. */
export function DocumentUpload({ supplierId }: { supplierId: string }) {
  const [kind, setKind] = useState<EvidenceKind>("test_report");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const base64 = await readAsBase64(file);
      const doc = await api.uploadDocument(supplierId, {
        kind,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        base64,
      });
      toast.success(`Uploaded ${doc.filename}`, { description: `sha256 ${doc.sha256.slice(0, 16)}… · fields extracted` });
      setFile(null);
      if (input.current) input.current.value = "";
      invalidateAll();
    } catch (e) {
      toast.error("Upload failed", { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3 border-t bg-muted/20 px-4 py-3">
      <Field label="Kind" htmlFor="doc-kind" className="w-52">
        <NativeSelect id="doc-kind" value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)}>
          {(Object.keys(EVIDENCE_KIND_LABEL) as EvidenceKind[]).map((k) => (
            <option key={k} value={k}>
              {EVIDENCE_KIND_LABEL[k]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="File (PDF preferred, max ~10 MB)" htmlFor="doc-file" className="min-w-60 flex-1">
        <input
          ref={input}
          id="doc-file"
          type="file"
          accept=".pdf,application/pdf,image/*,.csv,.xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block h-8 w-full rounded-lg border border-input bg-background text-xs file:mr-2 file:h-full file:border-0 file:border-r file:bg-muted file:px-2.5 file:text-xs file:font-medium"
        />
      </Field>
      <Button onClick={submit} disabled={!file || busy}>
        <UploadIcon /> {busy ? "Extracting…" : "Upload & extract"}
      </Button>
    </div>
  );
}

export function SupplierDetailView({ id }: { id: string }) {
  const q = useApi(`supplier:${id}`, () => api.getSupplier(id), 6000);
  const policy = useApi("policy", () => api.getPolicy());
  const [revoking, setRevoking] = useState<string | null>(null);

  if (q.error) {
    return (
      <div className="space-y-4">
        <Crumb name={id} />
        <ErrorState error={q.error} onRetry={q.refresh} />
      </div>
    );
  }
  if (!q.data) return <LoadingRows rows={8} />;
  const { supplier: s, checks, passports, documents } = q.data;
  const flagged = checks.filter((c) => c.status === "flag").length;

  const revoke = async (passportId: string) => {
    setRevoking(passportId);
    try {
      await api.revokePassport(passportId);
      toast.success("Passport revoked", { description: "Its status-list bit is set; verification now fails with “revoked”." });
      invalidateAll();
    } catch (e) {
      toast.error("Revoke failed", { description: errorMessage(e) });
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="space-y-5">
      <Crumb name={s.legalName} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{s.legalName}</h1>
            <CredentialBadge supplier={s} />
          </div>
          <div className="mt-1 text-[13px] text-muted-foreground">
            {s.domain} · {formatAddress(s.address)}
          </div>
        </div>
        <div className={cn("rounded-lg border px-3 py-2 text-xs", flagged ? "border-blocked/30 bg-blocked/5" : "border-approved/30 bg-approved/5")}>
          <span className={cn("font-semibold", flagged ? "text-blocked" : "text-approved")}>
            {flagged ? `${flagged} of ${checks.length} identity checks flagged` : `All ${checks.length} identity checks passed`}
          </span>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Panel title="Identity checks (Loop 1)" description="Run at enrollment and re-run by the agent on every case and change event">
            <div className="divide-y">
              {checks.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">No checks recorded.</div>
              ) : (
                checks.map((c) => <CheckRow key={c.kind} check={c} />)
              )}
            </div>
          </Panel>

          <Panel title="Part passports" description="Signed at manufacture; QR codes point at the public verification page">
            <div className="space-y-4 p-4">
              {passports.length === 0 ? (
                <div className="text-xs text-muted-foreground">No passports issued.</div>
              ) : (
                [...passports]
                  .sort((a, b) => b.version - a.version)
                  .map((p) => (
                    <PassportCard
                      key={p.id}
                      passport={p}
                      threshold={policy.data?.domesticContentThreshold}
                      restricted={policy.data?.restrictedCountries}
                      actions={
                        <>
                          <Link href={`/verify/${encodeURIComponent(p.id)}?presenter=1`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                            <ExternalLinkIcon /> Verify publicly
                          </Link>
                          {!p.revoked && (
                            <Button variant="destructive" size="sm" onClick={() => revoke(p.id)} disabled={revoking === p.id}>
                              {revoking === p.id ? "Revoking…" : "Revoke"}
                            </Button>
                          )}
                        </>
                      }
                    />
                  ))
              )}
            </div>
          </Panel>

          <Panel title="Evidence documents" description="Uploaded by buyers or received by the agent from the supplier's replies">
            <DocumentsTable docs={documents} />
            <DocumentUpload supplierId={s.id} />
          </Panel>
        </div>

        <div className="space-y-5 xl:sticky xl:top-16 xl:self-start">
          <Panel title="Entity">
            <dl className="divide-y px-4 py-1">
              <KeyValue label="Legal name">{s.legalName}</KeyValue>
              <KeyValue label="Domain">{s.domain}</KeyValue>
              <KeyValue label="Address">{formatAddress(s.address)}</KeyValue>
              <KeyValue label="UEI" mono>
                {s.uei ?? "—"}
              </KeyValue>
              <KeyValue label="CAGE" mono>
                {s.cageCode ?? "—"}
              </KeyValue>
              <KeyValue label="EIN" mono>
                {s.ein ?? "—"}
              </KeyValue>
              <KeyValue label="Contact">{s.contactEmail}</KeyValue>
              <KeyValue label="Claims US production">{s.claimedUsProduction ? "Yes" : "No"}</KeyValue>
              <KeyValue label="Enrolled">{formatDate(s.createdAt)}</KeyValue>
            </dl>
          </Panel>
          <Panel
            title={
              <span className="flex items-center gap-2">
                <KeyRoundIcon className="size-4" /> Supplier credential
              </span>
            }
            description="W3C VC 2.0, Ed25519-signed JWT. Reusable across buyers."
          >
            <div className="px-4 py-3">
              {s.credentialJwt ? (
                <>
                  <div className="font-mono text-[10.5px] break-all text-muted-foreground">{truncateMiddle(s.credentialJwt, 60, 30)}</div>
                  <button
                    className="mt-2 text-xs text-brand hover:underline"
                    onClick={() =>
                      navigator.clipboard?.writeText(s.credentialJwt!).then(
                        () => toast.success("Credential JWT copied"),
                        () => toast.error("Clipboard unavailable"),
                      )
                    }
                  >
                    Copy JWT
                  </button>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Not issued. Enrollment checks raised {flagged} flag{flagged === 1 ? "" : "s"}, so no credential was signed.
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Crumb({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Link href="/suppliers" className="hover:text-foreground">
        Suppliers
      </Link>
      <ChevronRightIcon className="size-3" />
      <span className="text-foreground">{name}</span>
    </div>
  );
}
