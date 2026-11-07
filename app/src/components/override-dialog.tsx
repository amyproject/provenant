"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UserRoundCogIcon } from "lucide-react";
import type { Decision } from "@/contracts";
import { api, errorMessage } from "@/lib/client/api";
import { invalidateAll } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DECISION_STYLE } from "@/components/status";

const OPTIONS: Exclude<Decision, "pending">[] = ["approved", "quarantined", "blocked"];

/** Human-in-the-loop escape hatch: POST /api/purchase-orders/:id/override. */
export function OverrideDialog({ purchaseOrderId, current, label }: { purchaseOrderId: string; current: Decision; label: string }) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<Exclude<Decision, "pending">>(current === "approved" ? "quarantined" : "approved");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await api.overridePurchaseOrder(purchaseOrderId, { decision, reason: reason.trim() });
      toast.success(`${label} overridden to ${DECISION_STYLE[decision].label.toLowerCase()}`, {
        description: "Recorded in the audit trail with your reason.",
      });
      setOpen(false);
      setReason("");
      invalidateAll();
    } catch (e) {
      toast.error("Override failed", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <UserRoundCogIcon />
        Human override
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Override the agent&apos;s decision</DialogTitle>
          <DialogDescription>
            {label} is currently <strong>{DECISION_STYLE[current].label.toLowerCase()}</strong>. The agent decides with deterministic
            rules; an override is recorded in the audit trail with your reason.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>New decision</Label>
            <div className="grid grid-cols-3 gap-2">
              {OPTIONS.map((d) => {
                const s = DECISION_STYLE[d];
                const active = decision === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDecision(d)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                      active ? s.cls + " ring-2 ring-current/20" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <s.Icon className="size-3.5" />
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="override-reason">Reason (required)</Label>
            <Textarea
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Supplier filed a signed change disclosure; buyer granted a waiver for the reducer through Q1."
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || reason.trim().length < 5 || decision === current}>
            {saving ? "Recording…" : "Record override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
