// THE hackathon must-pass test (spec "Demo script"): reset -> run -> autopilot drives every case ->
// A approved, B quarantined (F10), C blocked (F03+F06+F07) -> tamper A's passport -> bad_signature.
// Runs fully offline: no env keys, LIVE_PUBLIC_LOOKUPS unset, and any outbound fetch throws.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEMO,
  type AgentEvent,
  type DemoLabel,
  type DemoRunResponse,
  type FlagId,
  type IntegrationStatus,
  type OutboundMessage,
  type PartPassport,
  type PurchaseOrderDetail,
  type TamperResponse,
  type VerifyResult,
} from "@/contracts";
import { getPo, runDemoToCompletion } from "../helpers/demo";
import { call, decodeJwtPayload, trapFetch } from "../helpers/route";
import { routes } from "../helpers/routes";

const LABELS = ["A", "B", "C"] as const;
const flagged = (d: PurchaseOrderDetail): FlagId[] =>
  d.flags.filter((f) => f.status === "flag").map((f) => f.flag).sort();

async function events(caseId: string): Promise<AgentEvent[]> {
  const r = await call<AgentEvent[]>(await routes.agentEvents(), "GET", `/api/agent/cases/${caseId}/events`, {
    params: { id: caseId },
  });
  expect(r.status).toBe(200);
  return r.body;
}

async function getPassport(id: string): Promise<PartPassport> {
  const p = await call<PartPassport>(await routes.passport(), "GET", `/api/passports/${id}`, { params: { id } });
  expect(p.status).toBe(200);
  return p.body;
}

async function verify(jwt: string): Promise<VerifyResult> {
  const v = await call<VerifyResult>(await routes.verify(), "POST", "/api/verify", { body: { jwt } });
  expect(v.status).toBe(200);
  return v.body;
}

let net: ReturnType<typeof trapFetch>;
let run: DemoRunResponse;
const detail = {} as Record<DemoLabel, PurchaseOrderDetail>;

beforeAll(async () => {
  expect(process.env.LIVE_PUBLIC_LOOKUPS).toBeUndefined();
  net = trapFetch();
  ({ run } = await runDemoToCompletion());
  for (const r of run.results) detail[r.supplierLabel] = await getPo(r.purchaseOrderId);
});

afterAll(() => net?.restore());

describe("demo scenario (must pass)", () => {
  it("/demo/run creates exactly three POs + cases, one per fixed demo supplier", () => {
    expect(run.results.map((r) => r.supplierLabel).sort()).toEqual(["A", "B", "C"]);
    expect(new Set(run.results.map((r) => r.purchaseOrderId)).size).toBe(3);
    expect(new Set(run.results.map((r) => r.caseId)).size).toBe(3);
    for (const l of LABELS) {
      expect(detail[l].supplier.id).toBe(DEMO[l].supplierId);
      expect(detail[l].supplier.legalName).toBe(DEMO[l].legalName);
      expect(detail[l].purchaseOrder.riskTier).toBe(DEMO[l].riskTier);
      expect(detail[l].agentCase?.id).toBe(run.results.find((r) => r.supplierLabel === l)!.caseId);
    }
  });

  it("A approved, B quarantined, C blocked (DEMO.expected)", () => {
    for (const l of LABELS) expect({ l, d: detail[l].purchaseOrder.decision }).toEqual({ l, d: DEMO[l].expected });
  });

  it("A raises no flags", () => {
    expect(flagged(detail.A)).toEqual([]);
  });

  it("B is quarantined for exactly F10 (undisclosed sub-tier move)", () => {
    expect(flagged(detail.B)).toEqual(["F10_UNDISCLOSED_SUBTIER_CHANGE"]);
  });

  it("C is blocked for exactly F03 + F06 + F07", () => {
    expect(flagged(detail.C)).toEqual(["F03_REUSED_TEST_CERT", "F06_VIRTUAL_OFFICE", "F07_IMPERSONATOR_NAME"]);
  });

  it("every flag result carries the spec's Hackathon run mode", () => {
    const expectedMode: Record<FlagId, string> = {
      F01_SIGNATURE_INVALID: "live",
      F02_TAG_CLONE: "simulated",
      F03_REUSED_TEST_CERT: "live",
      F04_DOC_METADATA_MISMATCH: "seeded",
      F05_IMPORTED_FINISHED_GOODS: "seeded",
      F06_VIRTUAL_OFFICE: "live",
      F07_IMPERSONATOR_NAME: "live",
      F08_PRICE_LEADTIME_OUTLIER: "seeded",
      F09_BANK_CHANGE_NO_REAUTH: "simulated",
      F10_UNDISCLOSED_SUBTIER_CHANGE: "seeded",
    };
    for (const d of Object.values(detail))
      for (const f of d.flags) expect({ flag: f.flag, mode: f.mode }).toEqual({ flag: f.flag, mode: expectedMode[f.flag] });
  });

  it("high-tier POs evaluate all ten flags", () => {
    for (const l of LABELS) expect(new Set(detail[l].flags.map((f) => f.flag)).size).toBe(10);
  });

  it("flag explanations are non-empty for raised flags", () => {
    for (const d of [detail.B, detail.C])
      for (const f of d.flags.filter((x) => x.status === "flag")) expect(f.explanation.trim().length).toBeGreaterThan(10);
  });

  it("each decision has reasons and an EdDSA-signed decision record", () => {
    for (const l of LABELS) {
      const po = detail[l].purchaseOrder;
      expect(po.decisionJwt, `PO ${l} decisionJwt`).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      if (l !== "A") expect(po.decisionReasons.length).toBeGreaterThan(0);
      const header = JSON.parse(Buffer.from(po.decisionJwt!.split(".")[0], "base64url").toString());
      expect(header.alg).toBe("EdDSA");
      expect(JSON.stringify(decodeJwtPayload(po.decisionJwt!))).toContain(po.decision);
    }
  });

  it("each case finished on its own (closed/monitoring) with the PO's decision; A is monitoring", () => {
    for (const l of LABELS) {
      const c = detail[l].agentCase!;
      expect(["closed", "monitoring"]).toContain(c.state);
      expect(c.decision).toBe(detail[l].purchaseOrder.decision);
    }
    expect(detail.A.agentCase?.state).toBe("monitoring");
  });

  it("every case walks the autonomous pipeline in order", async () => {
    const order = ["intake", "screening", "gap_analysis", "requesting", "ingesting", "evaluating", "deciding", "signing", "enforcing"];
    for (const l of LABELS) {
      const ev = await events(detail[l].agentCase!.id);
      expect(ev.every((e) => e.caseId === detail[l].agentCase!.id)).toBe(true);
      const firstIdx = order.map((s) => ev.findIndex((e) => e.state === s));
      for (const [i, s] of order.entries()) expect(firstIdx[i], `${l}: no event in state ${s}`).toBeGreaterThanOrEqual(0);
      const sorted = [...firstIdx].sort((a, b) => a - b);
      expect(firstIdx, `${l}: states out of order`).toEqual(sorted);
    }
  });

  it("every case sent a Naive (stub) request and ingested a supplier reply before deciding", async () => {
    const outbox = await call<OutboundMessage[]>(await routes.agentOutbox(), "GET", "/api/agent/outbox");
    expect(outbox.status).toBe(200);
    for (const l of LABELS) {
      const c = detail[l].agentCase!;
      const sent = outbox.body.filter((m) => m.caseId === c.id);
      expect(sent.length, `${l}: outbox messages`).toBeGreaterThanOrEqual(1);
      for (const m of sent) {
        expect(m.provider).toBe("stub");
        expect(m.to).toBe(detail[l].supplier.contactEmail);
        expect(m.subject.length).toBeGreaterThan(0);
      }
      const ev = await events(c.id);
      const supplierReply = ev.findIndex((e) => e.actor === "supplier");
      const ingest = ev.findIndex((e) => e.state === "ingesting");
      const deciding = ev.findIndex((e) => e.state === "deciding");
      expect(supplierReply, `${l}: supplier reply event`).toBeGreaterThanOrEqual(0);
      expect(supplierReply).toBeLessThan(deciding);
      expect(ingest).toBeLessThan(deciding);
      // Every gap the agent opened was resolved by the reply.
      for (const g of c.gaps) expect(g.resolvedAt, `${l}: gap ${g.description}`).toBeTruthy();
    }
  });

  it("A's missing facility attestation was requested and resolved via the reply", () => {
    const gaps = detail.A.agentCase!.gaps;
    const fa = gaps.find((g) => g.kind === "facility_attestation");
    expect(fa, "A should have a facility_attestation gap").toBeTruthy();
    expect(fa!.attempts).toBeGreaterThanOrEqual(1);
    expect(fa!.resolvedAt).toBeTruthy();
  });

  describe("tamper closer", () => {
    let passportId: string;
    let original: PartPassport;
    let tampered: TamperResponse;

    beforeAll(async () => {
      passportId = detail.A.purchaseOrder.passportIds[0];
      expect(passportId).toBeTruthy();
      original = await getPassport(passportId);
    });

    it("A's genuine passport verifies, with decoded claims and issuer", async () => {
      const v = await verify(original.jwt);
      expect(v.valid).toBe(true);
      expect(v.revoked).toBe(false);
      expect(v.reason).toBeUndefined();
      expect(v.passport?.id).toBe(passportId);
      expect(v.issuer?.supplierId).toBe(DEMO.A.supplierId);
      expect(v.claims).toBeTruthy();
    });

    it("tamper edits only the payload (header + signature untouched)", async () => {
      const t = await call<TamperResponse>(await routes.demoTamper(), "POST", "/api/demo/tamper", {
        body: { passportId, path: "components.0.countryOfOrigin", value: "CN" },
      });
      expect(t.status).toBe(200);
      tampered = t.body;
      expect(tampered.tamperedJwt).not.toBe(original.jwt);
      const [h0, , s0] = original.jwt.split(".");
      const [h1, , s1] = tampered.tamperedJwt.split(".");
      expect(h1).toBe(h0);
      expect(s1).toBe(s0);
      expect(JSON.stringify(decodeJwtPayload(tampered.tamperedJwt))).toContain('"CN"');
    });

    it("the tamper persists: stored passport now fails with bad_signature and exposes the edited claim", async () => {
      const stored = await getPassport(passportId);
      expect(stored.jwt).toBe(tampered.tamperedJwt);
      const v = await verify(stored.jwt);
      expect(v.valid).toBe(false);
      expect(v.reason).toBe("bad_signature");
      expect(v.claims).toBeTruthy();
      expect(JSON.stringify(v.claims)).toContain('"CN"');
    });

    it("/demo/reset restores a valid passport", async () => {
      const r = await call(await routes.demoReset(), "POST", "/api/demo/reset");
      expect(r.status).toBe(200);
      const v = await verify((await getPassport(passportId)).jwt);
      expect(v.valid).toBe(true);
    });
  });

  it("made no outbound network calls (fixture mode)", () => {
    expect(net.calls).toEqual([]);
  });
});

describe("integration status in fixture mode", () => {
  it("reports stub/fixture/memory with no env keys", async () => {
    const r = await call<IntegrationStatus>(await routes.integrations(), "GET", "/api/integrations/status");
    expect(r.status).toBe(200);
    const { checkSources, ...rest } = r.body;
    expect(rest).toEqual({ naive: "stub", anthropic: "fixture", samGov: "fixture", storage: "memory", publicBaseUrl: null });
    // Contract v2.4: every identity check reports its data source; with no keys none may claim "live".
    expect(checkSources).toEqual({
      sam_registration: "fixture",
      sanctions: "fixture",
      address_cmra: "fixture",
      domain_age: "fixture",
      name_similarity: "fixture",
      shipping_history: "fixture",
    });
  });
});

describe("reset is repeatable", () => {
  it("reset + run twice yields the same outcomes and reset clears old POs", async () => {
    for (let i = 0; i < 2; i++) {
      const { run: r } = await runDemoToCompletion();
      for (const res of r.results) expect((await getPo(res.purchaseOrderId)).purchaseOrder.decision).toBe(DEMO[res.supplierLabel].expected);
    }
    const pos = await call<PurchaseOrderDetail[]>(await routes.purchaseOrders(), "GET", "/api/purchase-orders");
    expect(pos.body.length).toBe(3);
  });
});
