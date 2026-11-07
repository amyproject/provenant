// Thin glue for route handlers: JSON parsing + zod validation, ApiError responses, lazy seeding and
// autopilot start. Business logic stays in src/server/services and src/server/agent.
import type { z } from "zod";
import type { ApiError } from "@/contracts";
import { ensureAutopilot } from "./agent/autopilot";
import { env } from "./env";
import { ApiProblem, badRequest } from "./errors";
import { ensureSeeded } from "./seed";

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiProblem) {
    const body: ApiError = { error: err.message, ...(err.details !== undefined ? { details: err.details } : {}) };
    return Response.json(body, { status: err.status });
  }
  if (err instanceof Error && err.name === "NaiveNotImplementedError") {
    return Response.json({ error: err.message } satisfies ApiError, { status: 501 });
  }
  // Details stay in the server log; clients get a generic message.
  console.error("[api] unhandled error:", err);
  const body: ApiError = { error: "internal error" };
  return Response.json(body, { status: 500 });
}

/**
 * Wrap a handler. Reading `req.url` first, OUTSIDE the try/catch, marks the route as request-time under
 * Cache Components (no build-time prerender of live data); during prerender that access throws and must
 * propagate. Unlike connection(), it also works when tests call handlers directly.
 */
export async function handle(
  req: Request,
  fn: () => Promise<Response | unknown>,
  status = 200,
  access: Access = "guarded",
): Promise<Response> {
  void req.url;
  try {
    authorize(req, access);
    await ensureSeeded();
    ensureAutopilot();
    const out = await fn();
    return out instanceof Response ? out : Response.json(out, { status });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Route access when DEMO_ADMIN_TOKEN is set (public deploys): every non-GET request needs
 * `x-demo-token`, except "public" routes (POST /api/verify) and the "webhook" route, which also accepts
 * `x-webhook-secret` == NAIVE_WEBHOOK_SECRET. Unset token = open (local dev).
 */
export type Access = "guarded" | "public" | "webhook";

function authorize(req: Request, access: Access): void {
  const token = env.demoAdminToken();
  if (!token || req.method === "GET" || req.method === "HEAD" || access === "public") return;
  if (req.headers.get("x-demo-token") === token) return;
  // TODO(naive): replace the shared secret with Naive's webhook signature check once documented.
  const secret = process.env.NAIVE_WEBHOOK_SECRET?.trim();
  if (access === "webhook" && secret && req.headers.get("x-webhook-secret") === secret) return;
  throw new ApiProblem(401, "missing or invalid x-demo-token");
}

export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : undefined;
  } catch {
    throw badRequest("request body is not valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest(
      "invalid request body",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return parsed.data;
}
