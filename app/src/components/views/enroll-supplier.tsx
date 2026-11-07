"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRightIcon, ShieldCheckIcon, ShieldXIcon } from "lucide-react";
import type { EnrollSupplierRequest, EnrollSupplierResponse } from "@/contracts";
import { DEMO } from "@/contracts";
import { api, errorMessage } from "@/lib/client/api";
import { invalidateAll } from "@/lib/client/hooks";
import { IDENTITY_CHECK_LABEL } from "@/lib/domain-meta";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel } from "@/components/page";
import { Field } from "@/components/form";
import { EvidenceView } from "@/components/evidence-view";
import { CheckStatusBadge, CheckStatusIcon } from "@/components/status";

const EMPTY: EnrollSupplierRequest = {
  legalName: "",
  domain: "",
  address: { line1: "", city: "", state: "", zip: "", country: "US" },
  uei: "",
  cageCode: "",
  ein: "",
  contactEmail: "",
  claimedUsProduction: true,
};

// Fictional examples for live demos.
const EXAMPLES: { label: string; value: EnrollSupplierRequest }[] = [
  {
    label: "Legit machine shop",
    value: {
      legalName: "Cedar Valley Precision LLC",
      domain: "cedarvalleyprecision.example",
      address: { line1: "915 Foundry Rd", city: "Cedar Rapids", state: "IA", zip: "52404", country: "US" },
      uei: "CVP4M8R2TQ71",
      cageCode: "9CV12",
      ein: "42-7781023",
      contactEmail: "quality@cedarvalleyprecision.example",
      claimedUsProduction: true,
    },
  },
  {
    label: "Impersonator",
    value: {
      legalName: `${DEMO.A.legalName.replace(/ Inc\.?$/, "")}s LLC`,
      domain: "keystone-actuations.example",
      address: { line1: "77 Harbor Plaza, Ste 300 #2210", city: "Wilmington", state: "DE", zip: "19801", country: "US" },
      contactEmail: "sales@keystone-actuations.example",
      claimedUsProduction: true,
    },
  },
];

export function EnrollSupplierView() {
  const [form, setForm] = useState<EnrollSupplierRequest>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EnrollSupplierResponse | null>(null);

  const set = <K extends keyof EnrollSupplierRequest>(k: K, v: EnrollSupplierRequest[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setAddr = (k: keyof EnrollSupplierRequest["address"], v: string) => setForm((f) => ({ ...f, address: { ...f.address, [k]: v } }));

  const valid =
    form.legalName.trim() &&
    form.domain.trim() &&
    form.address.line1.trim() &&
    form.address.city.trim() &&
    form.address.state.trim() &&
    form.address.zip.trim() &&
    /^[A-Z]{2}$/i.test(form.address.country) &&
    /.+@.+\..+/.test(form.contactEmail);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const req: EnrollSupplierRequest = {
        ...form,
        address: { ...form.address, country: form.address.country.toUpperCase() },
        uei: form.uei?.trim() || undefined,
        cageCode: form.cageCode?.trim() || undefined,
        ein: form.ein?.trim() || undefined,
      };
      const res = await api.enrollSupplier(req);
      setResult(res);
      invalidateAll();
      const flags = res.checks.filter((c) => c.status === "flag").length;
      if (flags === 0) toast.success("Supplier enrolled", { description: "All checks passed; signed credential issued." });
      else toast.warning(`${flags} identity check${flags === 1 ? "" : "s"} flagged`, { description: "Credential withheld pending review." });
    } catch (err) {
      toast.error("Enrollment failed", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/suppliers" className="hover:text-foreground">
          Suppliers
        </Link>
        <ChevronRightIcon className="size-3" />
        <span className="text-foreground">Enroll</span>
      </div>
      <PageHeader
        title="Enroll a supplier"
        description="Enrollment runs Loop 1 synchronously: SAM.gov registration, sanctions and denied parties, USPS virtual-office (CMRA) check, domain age, name similarity to known suppliers and shipping history. A supplier that passes receives a signed credential."
        actions={
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Prefill:
            {EXAMPLES.map((ex) => (
              <Button key={ex.label} variant="outline" size="sm" type="button" onClick={() => setForm(ex.value)}>
                {ex.label}
              </Button>
            ))}
          </div>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Panel title="Supplier details">
          <form onSubmit={submit} className="grid gap-4 p-4 sm:grid-cols-6">
            <Field label="Legal name" htmlFor="e-name" className="sm:col-span-4">
              <Input id="e-name" value={form.legalName} onChange={(e) => set("legalName", e.target.value)} required />
            </Field>
            <Field label="Website domain" htmlFor="e-domain" className="sm:col-span-2">
              <Input id="e-domain" value={form.domain} onChange={(e) => set("domain", e.target.value)} placeholder="example.com" required />
            </Field>
            <Field label="Facility street address" htmlFor="e-line1" className="sm:col-span-6" hint="Use the production facility, not a mailing address.">
              <Input id="e-line1" value={form.address.line1} onChange={(e) => setAddr("line1", e.target.value)} required />
            </Field>
            <Field label="City" htmlFor="e-city" className="sm:col-span-2">
              <Input id="e-city" value={form.address.city} onChange={(e) => setAddr("city", e.target.value)} required />
            </Field>
            <Field label="State" htmlFor="e-state" className="sm:col-span-1">
              <Input id="e-state" value={form.address.state} onChange={(e) => setAddr("state", e.target.value)} required />
            </Field>
            <Field label="ZIP" htmlFor="e-zip" className="sm:col-span-2">
              <Input id="e-zip" value={form.address.zip} onChange={(e) => setAddr("zip", e.target.value)} required />
            </Field>
            <Field label="Country" htmlFor="e-country" className="sm:col-span-1">
              <Input id="e-country" value={form.address.country} maxLength={2} onChange={(e) => setAddr("country", e.target.value)} required />
            </Field>
            <Field label="UEI (SAM.gov)" htmlFor="e-uei" className="sm:col-span-2">
              <Input id="e-uei" value={form.uei ?? ""} onChange={(e) => set("uei", e.target.value)} className="font-mono" />
            </Field>
            <Field label="CAGE code" htmlFor="e-cage" className="sm:col-span-2">
              <Input id="e-cage" value={form.cageCode ?? ""} onChange={(e) => set("cageCode", e.target.value)} className="font-mono" />
            </Field>
            <Field label="EIN" htmlFor="e-ein" className="sm:col-span-2" hint="Collected from the supplier directly.">
              <Input id="e-ein" value={form.ein ?? ""} onChange={(e) => set("ein", e.target.value)} className="font-mono" />
            </Field>
            <Field label="Compliance contact email" htmlFor="e-email" className="sm:col-span-4" hint="The agent sends evidence requests here via Naive.">
              <Input id="e-email" type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} required />
            </Field>
            <label className="flex items-center gap-2 self-center text-[13px] sm:col-span-2">
              <input type="checkbox" checked={form.claimedUsProduction} onChange={(e) => set("claimedUsProduction", e.target.checked)} className="size-4 accent-current" />
              Claims US production
            </label>
            <div className="flex items-center justify-end gap-2 border-t pt-4 sm:col-span-6">
              <Button variant="outline" type="button" onClick={() => setForm(EMPTY)}>
                Clear
              </Button>
              <Button type="submit" disabled={!valid || busy}>
                {busy ? "Running checks…" : "Enroll and run checks"}
              </Button>
            </div>
          </form>
        </Panel>

        <Panel title="Result">
          {!result ? (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">Check results appear here after enrollment.</div>
          ) : (
            <EnrollResult result={result} />
          )}
        </Panel>
      </div>
    </div>
  );
}

function EnrollResult({ result }: { result: EnrollSupplierResponse }) {
  const ok = result.supplier.status === "enrolled";
  return (
    <div>
      <div className={cn("flex items-start gap-3 border-b px-4 py-3", ok ? "bg-approved/5" : "bg-blocked/5")}>
        {ok ? <ShieldCheckIcon className="mt-0.5 size-5 text-approved" /> : <ShieldXIcon className="mt-0.5 size-5 text-blocked" />}
        <div className="min-w-0 flex-1">
          <div className={cn("text-[13px] font-semibold", ok ? "text-approved" : "text-blocked")}>
            {ok ? "Enrolled: signed credential issued" : "Credential withheld"}
          </div>
          <div className="text-xs text-muted-foreground">{result.supplier.legalName}</div>
        </div>
        <Link href={`/suppliers/${encodeURIComponent(result.supplier.id)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Open supplier
        </Link>
      </div>
      <ul className="divide-y">
        {result.checks.map((c) => (
          <li key={c.kind} className="px-4 py-2.5">
            <div className="flex items-center gap-2 text-[13px]">
              <CheckStatusIcon status={c.status} />
              <span className="font-medium">{IDENTITY_CHECK_LABEL[c.kind].title}</span>
              <span className="ml-auto flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-muted-foreground uppercase">{c.source}</span>
                <CheckStatusBadge status={c.status} />
              </span>
            </div>
            {c.status !== "pass" && <EvidenceView data={c.evidence} className="mt-1.5 pl-6" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
