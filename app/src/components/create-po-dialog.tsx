"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import type { RiskTier } from "@/contracts";
import { api, errorMessage } from "@/lib/client/api";
import { invalidateAll, useApi } from "@/lib/client/hooks";
import { RISK_TIER_LABEL } from "@/lib/domain-meta";
import { poLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/form";

/** Buyer creates a PO; the backend opens an AgentCase automatically (no human step). */
export function CreatePoDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [passportId, setPassportId] = useState("");
  const [tier, setTier] = useState<RiskTier>("high");
  const [qty, setQty] = useState("100");
  const [unit, setUnit] = useState("");
  const [lead, setLead] = useState("42");
  const [saving, setSaving] = useState(false);

  const suppliers = useApi(open ? "suppliers" : null, () => api.listSuppliers());
  const detail = useApi(open && supplierId ? `supplier:${supplierId}` : null, () => api.getSupplier(supplierId));
  const passports = (detail.data?.passports ?? []).filter((p) => !p.revoked);
  const selected = passports.find((p) => p.id === passportId);
  const unitPrice = unit ? Number(unit) : selected?.totalCostUsd ?? 0;
  const amount = Math.round(unitPrice * Number(qty || 0));

  const submit = async () => {
    setSaving(true);
    try {
      const res = await api.createPurchaseOrder({
        supplierId,
        passportIds: [passportId],
        riskTier: tier,
        amountUsd: amount,
        quotedUnitPriceUsd: unitPrice || undefined,
        quotedLeadTimeDays: lead ? Number(lead) : undefined,
      });
      toast.success(`${poLabel(res.purchaseOrder.id)} created`, {
        description: "The agent opened a compliance case automatically. Turn on autopilot to watch it work.",
      });
      setOpen(false);
      invalidateAll();
      router.push(`/purchase-orders/${encodeURIComponent(res.purchaseOrder.id)}`);
    } catch (e) {
      toast.error("Could not create purchase order", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <PlusIcon />
        New purchase order
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>
            Creating the PO is the only human step. The agent opens a case, screens the supplier, chases missing evidence, evaluates
            the red flags and enforces the decision.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Supplier" htmlFor="po-supplier" className="col-span-2">
            <NativeSelect
              id="po-supplier"
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setPassportId("");
              }}
            >
              <option value="">{suppliers.loading ? "Loading…" : "Select a supplier"}</option>
              {suppliers.data?.map((s) => (
                <option key={s.supplier.id} value={s.supplier.id}>
                  {s.supplier.legalName} ({s.supplier.status})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Part passport" htmlFor="po-passport" className="col-span-2">
            <NativeSelect id="po-passport" value={passportId} onChange={(e) => setPassportId(e.target.value)} disabled={!supplierId}>
              <option value="">{detail.loading ? "Loading…" : passports.length ? "Select a passport" : "No passports on file"}</option>
              {passports.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.model} · v{p.version} · {p.serialOrBatch}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Risk tier" htmlFor="po-tier">
            <NativeSelect id="po-tier" value={tier} onChange={(e) => setTier(e.target.value as RiskTier)}>
              {(Object.keys(RISK_TIER_LABEL) as RiskTier[]).map((t) => (
                <option key={t} value={t}>
                  {RISK_TIER_LABEL[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Quantity" htmlFor="po-qty">
            <Input id="po-qty" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Quoted unit price (USD)" htmlFor="po-unit" hint={selected && !unit ? `Defaults to passport cost $${selected.totalCostUsd}` : undefined}>
            <Input id="po-unit" type="number" min={0} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={selected ? String(selected.totalCostUsd) : ""} />
          </Field>
          <Field label="Quoted lead time (days)" htmlFor="po-lead">
            <Input id="po-lead" type="number" min={0} value={lead} onChange={(e) => setLead(e.target.value)} />
          </Field>
        </div>
        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-muted-foreground">
            Order value <span className="font-semibold text-foreground tabular">${amount.toLocaleString("en-US")}</span>
          </span>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !supplierId || !passportId || amount <= 0}>
            {saving ? "Creating…" : "Create and hand to agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
