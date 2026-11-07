// Calls exported Next.js route handlers directly (no server). Next 16: ctx.params is a Promise.
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

export interface CallOptions {
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  /** Send this exact string as the body (for malformed-JSON tests). */
  rawBody?: string;
}

export interface CallResult<T = unknown> {
  status: number;
  body: T;
  res: Response;
}

export async function call<T = any>(
  mod: Record<string, unknown>,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  path: string,
  opts: CallOptions = {},
): Promise<CallResult<T>> {
  const handler = mod[method] as Handler | undefined;
  if (typeof handler !== "function") throw new Error(`route ${path} does not export ${method}`);
  const url = new URL(`http://localhost${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const hasBody = opts.rawBody !== undefined || opts.body !== undefined;
  const req = new Request(url, {
    method,
    headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...(opts.headers ?? {}) },
    body: hasBody ? (opts.rawBody ?? JSON.stringify(opts.body)) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // leave as text
  }
  return { status: res.status, body: body as T, res };
}

/** Decode a JWT payload without verifying (for assertions only). */
export function decodeJwtPayload(jwt: string): any {
  const [, payload] = jwt.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

/** Records every outbound fetch; fixture mode must make none. */
export function trapFetch() {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    throw new Error(`QA: outbound network call in fixture mode: ${calls.at(-1)}`);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}
