"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BotIcon } from "lucide-react";
import type { AutopilotStatus } from "@/contracts";
import { api, errorMessage } from "@/lib/client/api";
import { invalidateAll, useNow } from "@/lib/client/hooks";
import { formatRelative } from "@/lib/format";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const STATUS_POLL_MS = 2000;

interface AutopilotState {
  status: AutopilotStatus | null;
  setEnabled: (v: boolean) => void;
  error?: string;
}

const Ctx = createContext<AutopilotState | null>(null);

/**
 * The backend runs the agent's heartbeat (GET/POST /api/agent/autopilot). The browser only reads
 * its status and flips it on/off; it never advances cases itself.
 */
export function AutopilotProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [error, setError] = useState<string>();
  const lastSeenTick = useRef<string | null>(null);
  const lastOpen = useRef(0);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const s = await api.getAutopilot();
        if (!active) return;
        setStatus(s);
        setError(undefined);
        // A new heartbeat means case state changed: refresh every mounted query now.
        // (Idle ticks with nothing open are skipped.)
        if (s.lastTickAt && s.lastTickAt !== lastSeenTick.current) {
          lastSeenTick.current = s.lastTickAt;
          if (s.openCases > 0 || lastOpen.current > 0) invalidateAll();
        }
        lastOpen.current = s.openCases;
      } catch (e) {
        if (active) setError(errorMessage(e));
      }
    };
    poll();
    const t = setInterval(poll, STATUS_POLL_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const setEnabled = (v: boolean) => {
    setStatus((s) => (s ? { ...s, enabled: v } : s));
    api.setAutopilot(v).then(
      (s) => setStatus(s),
      (e) => {
        toast.error("Could not change autopilot", { description: errorMessage(e) });
        setStatus((s) => (s ? { ...s, enabled: !v } : s));
      },
    );
  };

  return <Ctx.Provider value={{ status, setEnabled, error }}>{children}</Ctx.Provider>;
}

export function useAutopilot(): AutopilotState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAutopilot must be used inside AutopilotProvider");
  return v;
}

/** Prominent "Autopilot ON · last tick 2s ago" indicator with an on/off switch. */
export function AutopilotToggle({ className }: { className?: string }) {
  const { status, setEnabled, error } = useAutopilot();
  const now = useNow(1000);
  const on = !!status?.enabled;
  const working = on && (status?.openCases ?? 0) > 0;
  return (
    <label
      title={
        error
          ? `Autopilot status unavailable: ${error}`
          : `The server heartbeat advances every open case every ${((status?.intervalMs ?? 0) / 1000).toFixed(1)}s with no human input.`
      }
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs transition-colors",
        error
          ? "border-blocked/30 bg-blocked/5"
          : on
            ? "border-agent/40 bg-agent/10 text-foreground"
            : "border-border bg-background text-muted-foreground",
        className,
      )}
    >
      <span className="relative flex size-2">
        {working && <span className="absolute inline-flex size-full animate-ping rounded-full bg-agent opacity-60" />}
        <span className={cn("relative inline-flex size-2 rounded-full", error ? "bg-blocked" : on ? "bg-agent" : "bg-muted-foreground/40")} />
      </span>
      <BotIcon className={cn("size-3.5", on ? "text-agent" : "")} />
      <span className="font-semibold tracking-tight">
        {error ? "Autopilot unavailable" : status === null ? "Autopilot…" : on ? "Autopilot ON" : "Autopilot OFF"}
      </span>
      {status && !error && (
        <span className="tabular hidden text-[11px] text-muted-foreground lg:inline">
          · {status.lastTickAt ? `last tick ${formatRelative(status.lastTickAt, now)}` : "no ticks yet"} · {status.openCases} open
        </span>
      )}
      <Switch
        checked={on}
        disabled={!status}
        onCheckedChange={(v) => setEnabled(v)}
        size="sm"
        className="data-checked:bg-agent"
        aria-label="Agent autopilot"
      />
    </label>
  );
}
