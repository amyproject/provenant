// Contract (api.ts): when DEMO_ADMIN_TOKEN is set, EVERY non-GET route requires x-demo-token, except
// POST /api/verify (public) and POST /api/webhooks/naive (token OR x-webhook-secret).
// Enumerates every route file so a newly added route cannot slip through unguarded.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "../helpers/route";

const modules = import.meta.glob("../../src/app/api/**/route.ts");
const METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
const PUBLIC = new Set(["POST /api/verify"]);

const apiPath = (file: string) =>
  file.replace(/^.*\/src\/app/, "").replace(/\/route\.ts$/, "").replace(/\[(\w+)\]/g, "qa_$1");

beforeAll(() => {
  process.env.DEMO_ADMIN_TOKEN = "qa-secret";
});
afterAll(() => {
  delete process.env.DEMO_ADMIN_TOKEN;
  delete process.env.NAIVE_WEBHOOK_SECRET;
});

describe("DEMO_ADMIN_TOKEN guards every mutating route", () => {
  it("found the route files", () => {
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(20);
  });

  it("every non-GET handler returns 401 without / with a wrong token (except /api/verify)", async () => {
    const checked: string[] = [];
    const failures: string[] = [];
    for (const [file, load] of Object.entries(modules)) {
      const mod = (await load()) as Record<string, unknown>;
      const path = apiPath(file);
      const params = Object.fromEntries([...file.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], `qa_${m[1]}`]));
      for (const method of METHODS) {
        if (typeof mod[method] !== "function") continue;
        const key = `${method} ${path}`;
        checked.push(key);
        for (const headers of [{}, { "x-demo-token": "wrong" }] as Record<string, string>[]) {
          const r = await call(mod, method, path, { params, body: {}, headers });
          const want = PUBLIC.has(key.replace(/qa_\w+/g, ":id")) ? "not 401" : 401;
          if (want === 401 ? r.status !== 401 : r.status === 401) failures.push(`${key} ${JSON.stringify(headers)} -> ${r.status}`);
        }
      }
    }
    expect(checked.length).toBeGreaterThanOrEqual(15);
    expect(failures).toEqual([]);
  });

  it("GET handlers stay open", async () => {
    const failures: string[] = [];
    for (const [file, load] of Object.entries(modules)) {
      const mod = (await load()) as Record<string, unknown>;
      if (typeof mod.GET !== "function") continue;
      const params = Object.fromEntries([...file.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], `qa_${m[1]}`]));
      const r = await call(mod, "GET", apiPath(file), { params });
      if (r.status === 401) failures.push(apiPath(file));
    }
    expect(failures).toEqual([]);
  });

  it("the correct token passes the guard on every mutating route", async () => {
    const failures: string[] = [];
    for (const [file, load] of Object.entries(modules)) {
      const mod = (await load()) as Record<string, unknown>;
      const params = Object.fromEntries([...file.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], `qa_${m[1]}`]));
      for (const method of METHODS) {
        if (typeof mod[method] !== "function") continue;
        // Skip state-wiping routes; the guard is the same code path and they are covered elsewhere.
        if (/\/demo\/(reset|run)$/.test(apiPath(file))) continue;
        const r = await call(mod, method, apiPath(file), { params, body: {}, headers: { "x-demo-token": "qa-secret" } });
        if (r.status === 401) failures.push(`${method} ${apiPath(file)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("webhook accepts x-demo-token, and x-webhook-secret when NAIVE_WEBHOOK_SECRET is set", async () => {
    const { POST } = await import("@/app/api/webhooks/naive/route");
    const body = { providerMessageId: "qa-hook-1", from: "nobody@example.com", subject: "s", body: "b", attachments: [] };
    const withToken = await call({ POST }, "POST", "/api/webhooks/naive", { body, headers: { "x-demo-token": "qa-secret" } });
    expect(withToken.status).not.toBe(401);
    process.env.NAIVE_WEBHOOK_SECRET = "hook";
    const withSecret = await call({ POST }, "POST", "/api/webhooks/naive", { body, headers: { "x-webhook-secret": "hook" } });
    expect(withSecret.status).not.toBe(401);
    const wrong = await call({ POST }, "POST", "/api/webhooks/naive", { body, headers: { "x-webhook-secret": "nope" } });
    expect(wrong.status).toBe(401);
  });
});
