// Shared fetch for live adapters only. Fixture adapters never call this.
export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${new URL(url).host} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
