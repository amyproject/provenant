// B2 crypto: Ed25519 VC-JWT passports, verification reasons, bitstring status list, tamper helper.
import { beforeEach, describe, expect, it } from "vitest";
import type { PartPassport, Supplier } from "@/contracts";
import { getRepo } from "@/server/repo";
import { getSupplierKey, supplierDid } from "@/server/crypto/keys";
import {
  allocateStatusIndex,
  encodeBitstring,
  isBitSet,
  revokeStatusIndex,
  STATUS_LIST_SIZE,
} from "@/server/crypto/statusList";
import { passportSubject, signCredential, signPassport, tamperJwt, verifyPassportJwt } from "@/server/crypto/vc";
import { decodeJwtPayload } from "../helpers/route";

const repo = getRepo();
const DAY = 86_400_000;

function supplier(id: string, legalName = `Supplier ${id}`): Supplier {
  return {
    id,
    legalName,
    domain: `${id}.example`,
    address: { line1: "1 Main St", city: "Erie", state: "PA", zip: "16501", country: "US" },
    contactEmail: `ops@${id}.example`,
    claimedUsProduction: true,
    status: "enrolled",
    createdAt: new Date().toISOString(),
  };
}

async function passport(supplierId: string, over: Partial<PartPassport> = {}): Promise<PartPassport> {
  const now = Date.now();
  const base: Omit<PartPassport, "jwt" | "revoked"> = {
    id: `pp_${Math.random().toString(36).slice(2, 10)}`,
    version: 1,
    supplierId,
    facility: { line1: "1 Main St", city: "Erie", state: "PA", zip: "16501", country: "US" },
    serialOrBatch: "LOT-1",
    model: "ACT-100",
    spec: "rotary actuator",
    components: [
      { name: "housing", supplierName: "US Castings", countryOfOrigin: "US", costUsd: 80 },
      { name: "reducer", supplierName: "Reducer Co", countryOfOrigin: "JP", costUsd: 20 },
    ],
    totalCostUsd: 100,
    domesticContentRatio: 0.8,
    testCertificates: [{ certNumber: "TC-1", issuer: "Lab", fileSha256: "a".repeat(64) }],
    issuedAt: new Date(now - DAY).toISOString(),
    expiresAt: new Date(now + 365 * DAY).toISOString(),
    statusIndex: await allocateStatusIndex(repo),
    ...over,
  };
  const jwt = await signPassport(base);
  return { ...base, revoked: false, jwt };
}

beforeEach(async () => {
  await repo.clear();
  await repo.suppliers.put(supplier("sup_qa1"));
  await repo.suppliers.put(supplier("sup_qa2"));
});

describe("passport sign/verify", () => {
  it("a freshly signed passport verifies; claims come from the JWT", async () => {
    const p = await passport("sup_qa1");
    const v = await verifyPassportJwt(p.jwt, repo);
    expect(v.valid).toBe(true);
    expect(v.revoked).toBe(false);
    expect(v.reason).toBeUndefined();
    expect(v.issuer).toEqual({ supplierId: "sup_qa1", legalName: "Supplier sup_qa1" });
    expect(v.passport?.id).toBe(p.id);
    expect(v.passport?.components).toEqual(p.components);
    expect(v.passport?.domesticContentRatio).toBe(0.8);
  });

  it("JWT is EdDSA, vc+jwt, issued by the supplier's DID", async () => {
    const p = await passport("sup_qa1");
    const header = JSON.parse(Buffer.from(p.jwt.split(".")[0], "base64url").toString());
    expect(header).toMatchObject({ alg: "EdDSA", typ: "vc+jwt" });
    const payload = decodeJwtPayload(p.jwt);
    expect(payload.iss).toBe(supplierDid("sup_qa1"));
    expect(payload.type).toContain("VerifiableCredential");
    expect(payload.credentialSubject.passportId).toBe(p.id);
  });

  it("tampered payload -> bad_signature (and decoded claims are exposed)", async () => {
    const p = await passport("sup_qa1");
    const t = tamperJwt(p.jwt, "components.1.countryOfOrigin", "CN");
    const v = await verifyPassportJwt(t, repo);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("bad_signature");
    expect(v.revoked).toBe(false);
    // Contract v2: claims decoded from the JWT are returned even when the signature fails.
    expect(v.claims, "VerifyResult.claims on bad_signature").toBeTruthy();
    expect(JSON.stringify(v.claims)).toContain('"CN"');
  });

  it("tampering a numeric claim (domestic content) also fails", async () => {
    const p = await passport("sup_qa1");
    const v = await verifyPassportJwt(tamperJwt(p.jwt, "domesticContentRatio", 1), repo);
    expect(v.reason).toBe("bad_signature");
  });

  it("flipping one signature character fails", async () => {
    const p = await passport("sup_qa1");
    const [h, b, s] = p.jwt.split(".");
    const flipped = s[5] === "A" ? "B" : "A";
    const v = await verifyPassportJwt(`${h}.${b}.${s.slice(0, 5)}${flipped}${s.slice(6)}`, repo);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("bad_signature");
  });

  it("signature made with another supplier's key but claiming this issuer -> bad_signature", async () => {
    // Impersonation: sup_qa2's private key, sup_qa1's DID. Verification must use the issuer's key.
    const k2 = await getSupplierKey("sup_qa2");
    await getSupplierKey("sup_qa1");
    const now = new Date().toISOString();
    const forged = await signCredential({
      key: { ...k2, did: supplierDid("sup_qa1"), kid: `${supplierDid("sup_qa1")}#key-1` },
      types: ["PartPassportCredential"],
      subject: passportSubject({
        id: "pp_forged",
        version: 1,
        supplierId: "sup_qa1",
        facility: supplier("x").address,
        serialOrBatch: "F",
        model: "F",
        spec: "F",
        components: [],
        totalCostUsd: 0,
        domesticContentRatio: 1,
        testCertificates: [],
        issuedAt: now,
        expiresAt: new Date(Date.now() + DAY).toISOString(),
        statusIndex: 0,
      }),
      validFrom: now,
      validUntil: new Date(Date.now() + DAY).toISOString(),
    });
    const v = await verifyPassportJwt(forged, repo);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("bad_signature");
  });

  it("a supplier cannot issue a passport naming another supplier", async () => {
    const k2 = await getSupplierKey("sup_qa2");
    const now = new Date().toISOString();
    const jwt = await signCredential({
      key: k2,
      types: ["PartPassportCredential"],
      subject: { id: "urn:x", type: "PartPassport", passportId: "pp_x", supplierId: "sup_qa1", statusIndex: 0 },
      validFrom: now,
      validUntil: new Date(Date.now() + DAY).toISOString(),
    });
    const v = await verifyPassportJwt(jwt, repo);
    expect(v.valid).toBe(false);
  });

  it("alg=none with a genuine payload is rejected", async () => {
    const p = await passport("sup_qa1");
    const none = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${p.jwt.split(".")[1]}.`;
    const v = await verifyPassportJwt(none, repo);
    expect(v.valid).toBe(false);
    expect(["bad_signature", "malformed"]).toContain(v.reason);
  });

  it("expired passport -> expired", async () => {
    const p = await passport("sup_qa1", {
      issuedAt: new Date(Date.now() - 400 * DAY).toISOString(),
      expiresAt: new Date(Date.now() - DAY).toISOString(),
    });
    const v = await verifyPassportJwt(p.jwt, repo);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("expired");
  });

  it("revoked via status list -> revoked (other passports unaffected)", async () => {
    const p = await passport("sup_qa1");
    const other = await passport("sup_qa1");
    await revokeStatusIndex(repo, p.statusIndex);
    const v = await verifyPassportJwt(p.jwt, repo);
    expect(v.valid).toBe(false);
    expect(v.revoked).toBe(true);
    expect(v.reason).toBe("revoked");
    expect((await verifyPassportJwt(other.jwt, repo)).valid).toBe(true);
  });

  it("issuer not known to the platform -> unknown_issuer", async () => {
    const p = await passport("sup_qa1");
    await repo.suppliers.delete("sup_qa1");
    const v = await verifyPassportJwt(p.jwt, repo);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("unknown_issuer");
  });

  it.each(["", "abc", "a.b", "a.b.c", "x".repeat(40), "eyJhbGciOiJFZERTQSJ9.e30.sig"])(
    "malformed input %j -> malformed, never throws",
    async (jwt) => {
      const v = await verifyPassportJwt(jwt, repo);
      expect(v.valid).toBe(false);
      expect(v.reason).toBe("malformed");
    },
  );

  it("non-string input does not throw", async () => {
    const v = await verifyPassportJwt(undefined as unknown as string, repo);
    expect(v.valid).toBe(false);
  });
});

describe("tamperJwt", () => {
  it("keeps header and signature byte-for-byte", async () => {
    const p = await passport("sup_qa1");
    const t = tamperJwt(p.jwt, "model", "EVIL");
    const [h0, , s0] = p.jwt.split(".");
    const [h1, b1, s1] = t.split(".");
    expect([h1, s1]).toEqual([h0, s0]);
    expect(JSON.parse(Buffer.from(b1, "base64url").toString()).credentialSubject.model).toBe("EVIL");
  });

  it("throws on a path that does not exist", async () => {
    const p = await passport("sup_qa1");
    expect(() => tamperJwt(p.jwt, "components.9.countryOfOrigin", "CN")).toThrow();
    expect(() => tamperJwt(p.jwt, "", "x")).toThrow();
    expect(() => tamperJwt("not-a-jwt", "model", "x")).toThrow();
  });
});

describe("bitstring status list", () => {
  it("encodes MSB-first, gzip, multibase u-prefix, 16KB minimum", () => {
    const enc = encodeBitstring([0, 7, 1000]);
    expect(enc.startsWith("u")).toBe(true);
    expect(isBitSet(enc, 0)).toBe(true);
    expect(isBitSet(enc, 7)).toBe(true);
    expect(isBitSet(enc, 1000)).toBe(true);
    expect(isBitSet(enc, 1)).toBe(false);
    expect(isBitSet(enc, 999)).toBe(false);
    expect(STATUS_LIST_SIZE).toBeGreaterThanOrEqual(131_072);
  });

  it("allocates unique, increasing indices", async () => {
    const a = await allocateStatusIndex(repo);
    const b = await allocateStatusIndex(repo);
    expect(b).toBe(a + 1);
  });
});
