"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";

// Tiny data layer: fetch on mount, optional polling, and a global invalidation signal so any
// mutation (demo run, override, autopilot tick) refreshes every mounted query.

const listeners = new Set<() => void>();

export function invalidateAll() {
  listeners.forEach((l) => l());
}

export interface Query<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  /** Epoch ms of the last successful fetch. */
  updatedAt: number | undefined;
  refresh: () => void;
}

interface State<T> {
  key: string | null;
  data?: T;
  error?: Error;
  updatedAt?: number;
}

/**
 * @param key   cache identity; pass null to skip fetching. Changing it discards stale data.
 * @param fetcher called on mount, on key change, every `intervalMs`, and on invalidateAll().
 */
export function useApi<T>(key: string | null, fetcher: () => Promise<T>, intervalMs?: number): Query<T> {
  const [state, setState] = useState<State<T>>({ key: null });
  const [nonce, setNonce] = useState(0);
  const fetchNow = useEffectEvent(() => fetcher());

  useEffect(() => {
    if (key === null) return;
    let active = true;
    const load = () => {
      fetchNow().then(
        (data) => {
          if (active) setState({ key, data, updatedAt: Date.now() });
        },
        (error: unknown) => {
          if (!active) return;
          setState((s) => ({
            key,
            data: s.key === key ? s.data : undefined,
            updatedAt: s.key === key ? s.updatedAt : undefined,
            error: error instanceof Error ? error : new Error(String(error)),
          }));
        },
      );
    };
    load();
    listeners.add(load);
    const timer = intervalMs ? setInterval(load, intervalMs) : undefined;
    return () => {
      active = false;
      listeners.delete(load);
      if (timer) clearInterval(timer);
    };
  }, [key, intervalMs, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const current = state.key === key;
  const data = current ? state.data : undefined;
  const error = current ? state.error : undefined;
  return {
    data,
    error,
    loading: key !== null && data === undefined && error === undefined,
    updatedAt: current ? state.updatedAt : undefined,
    refresh,
  };
}

/** Re-render every `ms` so relative timestamps ("12s ago") stay fresh. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
