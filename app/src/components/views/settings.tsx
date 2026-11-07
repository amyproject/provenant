"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { KeyRoundIcon, PlugIcon, SaveIcon, XIcon } from "lucide-react";
import type { BuyerPolicy, DataSource, EvidenceKind, FlagId, IdentityCheckKind, RiskTier } from "@/contracts";
import { api, DEMO_TOKEN_KEY, errorMessage, USE_MOCKS } from "@/lib/client/api";
import { invalidateAll, useApi } from "@/lib/client/hooks";
import { ALL_FLAGS, EVIDENCE_KIND_LABEL, FLAG_META, IDENTITY_CHECK_LABEL, INTEGRATIONS, flagLabel } from "@/lib/domain-meta";
import { countryName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingRows, PageHeader, Panel } from "@/components/page";
import { Field } from "@/components/form";
import { RunModeBadge } from "@/components/status";
import { useAutopilot } from "@/components/autopilot";

const TIERS: RiskTier[] = ["low", "medium", "high"];

function IntegrationsPanel() {
  const q = useApi("integrations", () => api.integrationStatus(), 15_000);
  const autopilot = useAutopilot();
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <PlugIcon className="size-4" /> Integrations
        </span>
      }
      description="Everything runs with zero secrets (fixture mode). Set the env vars on the server and restart to go live."
    >
      {q.error ? (
        <div className="p-4">
          <ErrorState error={q.error} onRetry={q.refresh} />
        </div>
      ) : !q.data ? (
        <LoadingRows rows={4} />
      ) : (
        <ul className="divide-y">
          {(Object.keys(INTEGRATIONS) as (keyof typeof INTEGRATIONS)[]).map((k) => {
            const meta = INTEGRATIONS[k];
            const value = q.data![k];
            const live = value === meta.liveValue;
            const pending = value === "live_pending" && "pendingLabel" in meta;
            return (
              <li key={k} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", live ? "bg-approved" : "bg-quarantined")} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">{meta.name}</span>
                    <span
                      className={cn(
                        "rounded-md border px-1.5 text-[11px] font-medium",
                        live ? "border-approved/25 bg-approved/10 text-approved" : "border-dashed border-quarantined/50 text-[color-mix(in_oklch,var(--quarantined),black_25%)]",
                      )}
                    >
                      {live ? `Live (${value})` : pending ? meta.pendingLabel : meta.offLabel}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{meta.role}</div>
                  {pending && (
                    <div className="mt-1.5 text-[11px] text-muted-foreground">
                      NAIVE_API_KEY is set, but the live adapter is not wired up yet, so emails still go through the stub adapter.
                    </div>
                  )}
                  {!live && !pending && (
                    <div className="mt-1.5 text-[11px] text-muted-foreground">
                      To enable, set {meta.env.map((e, i) => (
                        <span key={e}>
                          {i > 0 && " and "}
                          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px] text-foreground">{e}</code>
                        </span>
                      ))}{" "}
                      in <code className="font-mono text-[10.5px]">app/.env.local</code>.
                      {k === "naive" && " Until then the agent's emails are recorded by the stub adapter and supplier replies come from fixtures."}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {q.data.checkSources && (
            <li className="px-4 py-3">
              <div className="text-[13px] font-medium">Identity check data</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Where each Loop 1 check gets its inputs. Flags marked live run real logic; with fixture inputs they read &ldquo;live logic ·
                fixture data&rdquo;.
              </div>
              <ul className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                {(Object.entries(q.data.checkSources) as [IdentityCheckKind, DataSource][]).map(([k, src]) => (
                  <li key={k} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1">
                    <span className="truncate">
                      {IDENTITY_CHECK_LABEL[k]?.title ?? k}
                      <span className="ml-1 text-muted-foreground">({IDENTITY_CHECK_LABEL[k]?.source ?? "?"})</span>
                    </span>
                    <span className={cn("font-mono text-[10.5px]", src === "live" ? "text-approved" : "text-[color-mix(in_oklch,var(--quarantined),black_25%)]")}>
                      {src}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          )}
          <li className="flex flex-wrap items-start gap-3 px-4 py-3">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", q.data.publicBaseUrl ? "bg-approved" : "bg-muted-foreground/40")} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">QR code base URL</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {q.data.publicBaseUrl ? (
                  <span className="font-mono text-foreground">{q.data.publicBaseUrl}</span>
                ) : (
                  <>
                    Not set: QR codes use this browser&apos;s origin. Set{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px] text-foreground">PUBLIC_BASE_URL</code> so a phone
                    scan reaches the public deploy.
                  </>
                )}
              </div>
            </div>
          </li>
          <li className="flex flex-wrap items-start gap-3 px-4 py-3">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", autopilot.status?.enabled ? "bg-agent" : "bg-muted-foreground/40")} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">Agent autopilot</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {autopilot.status
                  ? `Server heartbeat (${autopilot.status.enabled ? "on" : "off"}), every ${(autopilot.status.intervalMs / 1000).toFixed(1)}s. Toggle it from the top bar.`
                  : `Status unavailable${autopilot.error ? `: ${autopilot.error}` : ""}.`}
              </div>
            </div>
          </li>
          {USE_MOCKS && (
            <li className="px-4 py-3 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Mock data mode</span> is on (NEXT_PUBLIC_USE_MOCKS=1). These statuses come from
              the in-browser simulator. Unset it to talk to the real API.
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

/** Optional x-demo-token for deployments that set DEMO_ADMIN_TOKEN; kept in this browser only. */
const tokenListeners = new Set<() => void>();
function subscribeToken(cb: () => void) {
  tokenListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    tokenListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function readToken() {
  try {
    return window.localStorage.getItem(DEMO_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function DemoTokenPanel() {
  const stored = useSyncExternalStore(subscribeToken, readToken, () => "");
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? stored;
  const setValue = setDraft;
  const save = (v: string) => {
    try {
      if (v) window.localStorage.setItem(DEMO_TOKEN_KEY, v);
      else window.localStorage.removeItem(DEMO_TOKEN_KEY);
      tokenListeners.forEach((l) => l());
      setDraft(null);
      toast.success(v ? "Demo token saved in this browser" : "Demo token cleared");
    } catch {
      toast.error("Browser storage is unavailable");
    }
  };
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <KeyRoundIcon className="size-4" /> Demo admin token
        </span>
      }
      description="Only needed on public deploys that set DEMO_ADMIN_TOKEN. Sent as x-demo-token on demo, policy and override calls."
    >
      <div className="flex gap-2 p-4">
        <Input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Optional"
          autoComplete="off"
          aria-label="Demo admin token"
        />
        <Button variant="outline" onClick={() => save(value.trim())}>
          Save
        </Button>
        {value && (
          <Button
            variant="ghost"
            onClick={() => {
              setValue("");
              save("");
            }}
          >
            Clear
          </Button>
        )}
      </div>
    </Panel>
  );
}

function CountryChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const codes = draft
      .split(/[\s,]+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c) && !value.includes(c));
    if (codes.length) onChange([...value, ...codes]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
        {value.map((c) => (
          <span key={c} className="inline-flex items-center gap-1 rounded-md border border-blocked/25 bg-blocked/5 py-0.5 pr-1 pl-1.5 text-xs">
            <span className="font-mono font-medium">{c}</span>
            <span className="text-muted-foreground">{countryName(c)}</span>
            <button type="button" onClick={() => onChange(value.filter((x) => x !== c))} className="rounded p-0.5 hover:bg-muted" aria-label={`Remove ${c}`}>
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="ISO-3166 alpha-2, e.g. CN, RU"
          className="max-w-56"
        />
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

function PolicyEditor({ initial }: { initial: BuyerPolicy }) {
  const [p, setP] = useState<BuyerPolicy>(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(p) !== JSON.stringify(initial);
  const invalid = p.blockAtFlagCount < p.quarantineAtFlagCount || p.quarantineAtFlagCount < 1;

  const toggleFlag = (tier: RiskTier, flag: FlagId) =>
    setP((x) => {
      const has = x.tierFlags[tier].includes(flag);
      const next = has ? x.tierFlags[tier].filter((f) => f !== flag) : [...x.tierFlags[tier], flag];
      return { ...x, tierFlags: { ...x.tierFlags, [tier]: ALL_FLAGS.filter((f) => next.includes(f)) } };
    });
  const toggleEvidence = (tier: RiskTier, kind: EvidenceKind) =>
    setP((x) => {
      const cur = x.tierRequiredEvidence?.[tier] ?? [];
      const next = cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind];
      return { ...x, tierRequiredEvidence: { ...x.tierRequiredEvidence, [tier]: next } };
    });

  const save = async () => {
    setSaving(true);
    try {
      await api.putPolicy(p);
      toast.success("Buyer policy saved", { description: "New cases use it immediately; decided orders keep their signed records." });
      invalidateAll();
    } catch (e) {
      toast.error("Could not save policy", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="Buyer policy"
      description="Deterministic rules the agent applies at the policy gate. AI extracts and explains; these rules decide."
      actions={
        <>
          {dirty && (
            <Button variant="ghost" size="sm" onClick={() => setP(initial)}>
              Discard
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={!dirty || saving || invalid}>
            <SaveIcon /> {saving ? "Saving…" : "Save policy"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 p-4 md:grid-cols-2">
        <Field label="Policy name" htmlFor="pol-name">
          <Input id="pol-name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        </Field>
        <Field
          label={`Domestic content threshold: ${Math.round(p.domesticContentThreshold * 100)}%`}
          htmlFor="pol-dc"
          hint="Buy American: 65% through 2028, 75% from 2029. Have counsel confirm."
        >
          <div className="flex items-center gap-3">
            <input
              id="pol-dc"
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(p.domesticContentThreshold * 100)}
              onChange={(e) => setP({ ...p, domesticContentThreshold: Number(e.target.value) / 100 })}
              className="flex-1 accent-[var(--brand)]"
            />
            <div className="flex gap-1">
              {[65, 75].map((v) => (
                <Button key={v} type="button" size="xs" variant="outline" onClick={() => setP({ ...p, domesticContentThreshold: v / 100 })}>
                  {v}%
                </Button>
              ))}
            </div>
          </div>
        </Field>
        <Field label="Restricted countries (sub-tier origin)" className="md:col-span-2">
          <CountryChips value={p.restrictedCountries} onChange={(v) => setP({ ...p, restrictedCountries: v })} />
        </Field>
        <Field label="Quarantine at (flags)" htmlFor="pol-q" hint="Spec: any one flag quarantines.">
          <Input
            id="pol-q"
            type="number"
            min={1}
            value={p.quarantineAtFlagCount}
            onChange={(e) => setP({ ...p, quarantineAtFlagCount: Number(e.target.value) })}
            aria-invalid={invalid}
          />
        </Field>
        <Field label="Block at (flags)" htmlFor="pol-b" hint="Spec: multiple flags block. Must be ≥ quarantine.">
          <Input
            id="pol-b"
            type="number"
            min={1}
            value={p.blockAtFlagCount}
            onChange={(e) => setP({ ...p, blockAtFlagCount: Number(e.target.value) })}
            aria-invalid={invalid}
          />
        </Field>
        <Field label="Re-chase unanswered requests after (hours)" htmlFor="pol-rc">
          <Input
            id="pol-rc"
            type="number"
            min={0}
            step={0.25}
            value={Math.round(((p.rechaseIntervalSec ?? 0) / 3600) * 100) / 100}
            onChange={(e) => setP({ ...p, rechaseIntervalSec: Math.round(Number(e.target.value) * 3600) })}
          />
        </Field>
        <Field label="Escalate to a human after (unanswered requests)" htmlFor="pol-max">
          <Input id="pol-max" type="number" min={1} value={p.maxChaseAttempts ?? 0} onChange={(e) => setP({ ...p, maxChaseAttempts: Number(e.target.value) })} />
        </Field>
      </div>

      <div className="border-t">
        <div className="px-4 pt-3 pb-1 text-xs font-medium">Red flags evaluated per risk tier</div>
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1.5 text-left font-medium">Flag</th>
                <th className="py-1.5 text-left font-medium">Build</th>
                {TIERS.map((t) => (
                  <th key={t} className="w-20 py-1.5 text-center font-medium capitalize">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {ALL_FLAGS.map((f) => (
                <tr key={f}>
                  <td className="py-1.5">
                    <span className="mr-2 font-mono text-[11px] text-muted-foreground">{flagLabel(f)}</span>
                    {FLAG_META[f].title}
                  </td>
                  <td className="py-1.5">
                    <RunModeBadge mode={FLAG_META[f].hackathonMode} />
                  </td>
                  {TIERS.map((t) => (
                    <td key={t} className="py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={p.tierFlags[t].includes(f)}
                        onChange={() => toggleFlag(t, f)}
                        className="size-3.5 accent-[var(--brand)]"
                        aria-label={`${flagLabel(f)} for ${t} tier`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="border-t">
        <div className="px-4 pt-3 pb-1 text-xs font-medium">Evidence the agent must hold before deciding (drives gap analysis)</div>
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1.5 text-left font-medium">Evidence</th>
                {TIERS.map((t) => (
                  <th key={t} className="w-20 py-1.5 text-center font-medium capitalize">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {(Object.keys(EVIDENCE_KIND_LABEL) as EvidenceKind[]).map((k) => (
                <tr key={k}>
                  <td className="py-1.5">{EVIDENCE_KIND_LABEL[k]}</td>
                  {TIERS.map((t) => (
                    <td key={t} className="py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={(p.tierRequiredEvidence?.[t] ?? []).includes(k)}
                        onChange={() => toggleEvidence(t, k)}
                        className="size-3.5 accent-[var(--brand)]"
                        aria-label={`${EVIDENCE_KIND_LABEL[k]} for ${t} tier`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

export function SettingsView() {
  const policy = useApi("policy", () => api.getPolicy());
  return (
    <div>
      <PageHeader title="Settings" description="Integration status and the buyer policy the agent enforces." />
      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-5">
          <IntegrationsPanel />
          <DemoTokenPanel />
        </div>
        {policy.error ? (
          <ErrorState error={policy.error} onRetry={policy.refresh} />
        ) : !policy.data ? (
          <Panel title="Buyer policy">
            <LoadingRows rows={6} />
          </Panel>
        ) : (
          <PolicyEditor key={JSON.stringify(policy.data)} initial={policy.data} />
        )}
      </div>
    </div>
  );
}
