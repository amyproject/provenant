// Regression (supervisor CRITICAL): with PUBLIC_BASE_URL on a LAN IP + port (the QR-scan demo setup),
// supplier DIDs must still resolve; genuine passports verify and A/B/C keep their outcomes.
// Set before any key/DID is generated (each test file runs in its own process).
process.env.PUBLIC_BASE_URL = "http://192.168.1.5:3000";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO, type IntegrationStatus, type PartPassport, type PurchaseOrderDetail, type VerifyResult } from "@/contracts";
import { getPo, runDemoToCompletion } from "../helpers/demo";
import { call, decodeJwtPayload, trapFetch } from "../helpers/route";
import { routes } from "../helpers/routes";

let net: ReturnType<typeof trapFetch>;
const detail = {} as Record<"A" | "B" | "C", PurchaseOrderDetail>;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "http://192.168.1.5:3000";
  net = trapFetch();
  const { run } = await runDemoToCompletion();
  for (const r of run.results) detail[r.supplierLabel] = await getPo(r.purchaseOrderId);
});
afterAll(() => {
  net?.restore();
  delete process.env.PUBLIC_BASE_URL;
});

describe("demo with PUBLIC_BASE_URL=http://192.168.1.5:3000", () => {
  it("integration status reports the base URL", async () => {
    const r = await call<IntegrationStatus>(await routes.integrations(), "GET", "/api/integrations/status");
    expect(r.body.publicBaseUrl).toBe("http://192.168.1.5:3000");
  });

  it("A approved, B quarantined, C blocked", () => {
    for (const l of ["A", "B", "C"] as const) expect({ l, d: detail[l].purchaseOrder.decision }).toEqual({ l, d: DEMO[l].expected });
  });

  it("A raises no flags (in particular no F01 unknown_issuer)", () => {
    expect(detail.A.flags.filter((f) => f.status === "flag").map((f) => f.flag)).toEqual([]);
  });

  it("every seeded passport verifies and resolves its issuer", async () => {
    for (const id of ["pp_A_1", "pp_B_1", "pp_C_1"]) {
      const p = (await call<PartPassport>(await routes.passport(), "GET", `/api/passports/${id}`, { params: { id } })).body;
      const v = (await call<VerifyResult>(await routes.verify(), "POST", "/api/verify", { body: { jwt: p.jwt } })).body;
      expect({ id, valid: v.valid, reason: v.reason }).toEqual({ id, valid: true, reason: undefined });
      expect(v.issuer?.supplierId).toBe(p.supplierId);
      // did:web encodes the port colon as %3A (W3C did:web spec).
      const iss = String(decodeJwtPayload(p.jwt).iss);
      expect(iss.startsWith("did:web:192.168.1.5%3A3000")).toBe(true);
    }
  });

  it("tamper still fails with bad_signature (not unknown_issuer)", async () => {
    const t = await call<{ tamperedJwt: string }>(await routes.demoTamper(), "POST", "/api/demo/tamper", {
      body: { passportId: "pp_A_1", path: "components.0.countryOfOrigin", value: "CN" },
    });
    expect(t.status).toBe(200);
    const v = (await call<VerifyResult>(await routes.verify(), "POST", "/api/verify", { body: { jwt: t.body.tamperedJwt } })).body;
    expect(v.reason).toBe("bad_signature");
  });

  it("made no outbound network calls", () => {
    expect(net.calls).toEqual([]);
  });
});
