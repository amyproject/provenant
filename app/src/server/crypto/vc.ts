// W3C Verifiable Credentials 2.0, secured as JWTs (vc+jwt) with Ed25519 via jose.
// Three credential types: supplier identity (platform-issued), part passport (supplier-issued),
// purchase decision record (platform-issued). Plus the bitstring status list credential.
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, decodeJwt, decodeProtectedHeader, errors, jwtVerify, type JWTPayload } from "jose";
import type {
  BuyerPolicy,
  FlagResult,
  IdentityCheckResult,
  PartPassport,
  PurchaseOrder,
  Supplier,
  VerifyResult,
} from "@/contracts";
import type { Repo } from "../repo";
import {
  SIGNING_ALG,
  findSupplierPublicJwk,
  getPlatformKey,
  getSupplierKey,
  importKey,
  supplierIdFromDid,
  type KeyRecord,
} from "./keys";
import { PASSPORT_LIST_ID, encodedListFor, isRevoked, statusEntry, statusListUrl } from "./statusList";

export const VC_CONTEXT = "https://www.w3.org/ns/credentials/v2";
const toSeconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

interface CredentialInput {
  key: KeyRecord;
  types: string[];
  subject: Record<string, unknown>;
  validFrom: string;
  validUntil?: string;
  credentialStatus?: Record<string, unknown>;
  /** Stable credential id; random urn:uuid if omitted. */
  id?: string;
}

export async function signCredential(input: CredentialInput): Promise<string> {
  const { key, types, subject, validFrom, validUntil, credentialStatus } = input;
  const id = input.id ?? `urn:uuid:${randomUUID()}`;
  const vc: JWTPayload = {
    "@context": [VC_CONTEXT],
    id,
    type: ["VerifiableCredential", ...types],
    issuer: key.did,
    validFrom,
    ...(validUntil ? { validUntil } : {}),
    credentialSubject: subject,
    ...(credentialStatus ? { credentialStatus } : {}),
  };
  let jwt = new SignJWT(vc)
    .setProtectedHeader({ alg: SIGNING_ALG, typ: "vc+jwt", kid: key.kid })
    .setIssuer(key.did)
    .setJti(id)
    .setIssuedAt(toSeconds(validFrom));
  if (typeof subject.id === "string") jwt = jwt.setSubject(subject.id);
  if (validUntil) jwt = jwt.setExpirationTime(toSeconds(validUntil));
  return jwt.sign(await importKey(key.privateJwk));
}

// ---------- Part passport ----------

export const passportSubjectId = (passportId: string) => `urn:provenant:passport:${passportId}`;

/** Claims that go into the passport credentialSubject (everything except the JWT and live revocation). */
export function passportSubject(p: Omit<PartPassport, "jwt" | "revoked">): Record<string, unknown> {
  return {
    id: passportSubjectId(p.id),
    type: "PartPassport",
    passportId: p.id,
    version: p.version,
    ...(p.prevVersionId ? { prevVersionId: p.prevVersionId } : {}),
    supplierId: p.supplierId,
    facility: p.facility,
    serialOrBatch: p.serialOrBatch,
    model: p.model,
    spec: p.spec,
    components: p.components,
    totalCostUsd: p.totalCostUsd,
    domesticContentRatio: p.domesticContentRatio,
    testCertificates: p.testCertificates,
    ...(p.firmwareVersion ? { firmwareVersion: p.firmwareVersion } : {}),
    issuedAt: p.issuedAt,
    expiresAt: p.expiresAt,
    statusIndex: p.statusIndex,
  };
}

export async function signPassport(p: Omit<PartPassport, "jwt" | "revoked">): Promise<string> {
  return signCredential({
    key: await getSupplierKey(p.supplierId),
    types: ["PartPassportCredential"],
    id: `urn:provenant:passport-credential:${p.id}`,
    subject: passportSubject(p),
    validFrom: p.issuedAt,
    validUntil: p.expiresAt,
    credentialStatus: statusEntry(PASSPORT_LIST_ID, p.statusIndex),
  });
}

function passportFromSubject(s: Record<string, unknown>, revoked: boolean): Omit<PartPassport, "jwt"> {
  return {
    id: String(s.passportId),
    version: Number(s.version),
    ...(s.prevVersionId ? { prevVersionId: String(s.prevVersionId) } : {}),
    supplierId: String(s.supplierId),
    facility: s.facility as PartPassport["facility"],
    serialOrBatch: String(s.serialOrBatch),
    model: String(s.model),
    spec: String(s.spec),
    components: (s.components ?? []) as PartPassport["components"],
    totalCostUsd: Number(s.totalCostUsd),
    domesticContentRatio: Number(s.domesticContentRatio),
    testCertificates: (s.testCertificates ?? []) as PartPassport["testCertificates"],
    ...(s.firmwareVersion ? { firmwareVersion: String(s.firmwareVersion) } : {}),
    issuedAt: String(s.issuedAt),
    expiresAt: String(s.expiresAt),
    statusIndex: Number(s.statusIndex),
    revoked,
  };
}

/**
 * Verify a passport JWT: structure -> issuer key -> Ed25519 signature + expiry -> status list.
 * The JWT is the proof; the returned passport is rebuilt from the verified claims, not the DB row.
 */
export async function verifyPassportJwt(jwt: string, repo: Repo): Promise<VerifyResult> {
  const fail = (reason: NonNullable<VerifyResult["reason"]>, extra: Partial<VerifyResult> = {}): VerifyResult => ({
    valid: false,
    revoked: reason === "revoked",
    reason,
    ...extra,
  });

  if (typeof jwt !== "string" || jwt.split(".").length !== 3) return fail("malformed");
  let header: ReturnType<typeof decodeProtectedHeader>;
  let claims: JWTPayload;
  try {
    header = decodeProtectedHeader(jwt);
    claims = decodeJwt(jwt);
  } catch {
    return fail("malformed");
  }
  const subject = claims.credentialSubject as Record<string, unknown> | undefined;
  if (!subject || typeof subject !== "object" || !Array.isArray(claims.type)) return fail("malformed");
  // Decoded (unverified) claims are returned on every outcome so a tamper is visible next to the failure.
  const decoded = claims as Record<string, unknown>;

  const supplierId = supplierIdFromDid(claims.iss);
  const publicJwk = supplierId ? findSupplierPublicJwk(supplierId) : null;
  const supplier = supplierId ? await repo.suppliers.get(supplierId) : null;
  if (!supplierId || !publicJwk || !supplier) return fail("unknown_issuer", { claims: decoded });
  const issuer = { supplierId, legalName: supplier.legalName };
  const base = { issuer, claims: decoded };

  if (header.alg !== SIGNING_ALG) return fail("bad_signature", base);
  try {
    await jwtVerify(jwt, await importKey(publicJwk), { algorithms: [SIGNING_ALG], issuer: claims.iss });
  } catch (err) {
    if (err instanceof errors.JWTExpired) return fail("expired", base);
    if (err instanceof errors.JWSSignatureVerificationFailed || err instanceof errors.JOSEAlgNotAllowed) {
      return fail("bad_signature", base);
    }
    return fail("malformed", base);
  }

  // Signature is good: claims are authentic. The passport must also name its own issuer.
  if (String(subject.supplierId) !== supplierId) return fail("bad_signature", base);
  const revoked = await isRevoked(repo, Number(subject.statusIndex));
  const passport = passportFromSubject(subject, revoked);
  if (revoked) return { valid: false, revoked: true, reason: "revoked", passport, ...base };
  return { valid: true, revoked: false, passport, ...base };
}

// ---------- Supplier credential ----------

export async function signSupplierCredential(s: Supplier, checks: IdentityCheckResult[]): Promise<string> {
  const issuedAt = new Date().toISOString();
  return signCredential({
    key: await getPlatformKey(),
    types: ["SupplierIdentityCredential"],
    subject: {
      id: `urn:provenant:supplier:${s.id}`,
      type: "Supplier",
      supplierId: s.id,
      supplierDid: (await getSupplierKey(s.id)).did,
      legalName: s.legalName,
      domain: s.domain,
      address: s.address,
      ...(s.uei ? { uei: s.uei } : {}),
      ...(s.cageCode ? { cageCode: s.cageCode } : {}),
      claimedUsProduction: s.claimedUsProduction,
      identityChecks: checks.map((c) => ({ kind: c.kind, status: c.status, source: c.source, checkedAt: c.checkedAt })),
    },
    validFrom: issuedAt,
    validUntil: new Date(Date.now() + 365 * 86_400_000).toISOString(),
  });
}

// ---------- Decision record ----------

export const sha256OfJwt = (jwt: string) => createHash("sha256").update(jwt).digest("hex");

export async function signDecisionRecord(input: {
  po: PurchaseOrder;
  policy: BuyerPolicy;
  passports: PartPassport[];
  flags: FlagResult[];
  decidedAt: string;
}): Promise<string> {
  const { po, policy, passports, flags, decidedAt } = input;
  return signCredential({
    key: await getPlatformKey(),
    types: ["PurchaseDecisionCredential"],
    subject: {
      id: `urn:provenant:purchase-order:${po.id}`,
      type: "PurchaseDecision",
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      riskTier: po.riskTier,
      amountUsd: po.amountUsd,
      decision: po.decision,
      reasons: po.decisionReasons,
      ...(po.humanOverride ? { humanOverride: po.humanOverride } : {}),
      policy: {
        id: policy.id,
        domesticContentThreshold: policy.domesticContentThreshold,
        quarantineAtFlagCount: policy.quarantineAtFlagCount,
        blockAtFlagCount: policy.blockAtFlagCount,
        evaluatedFlags: policy.tierFlags[po.riskTier],
      },
      flags: flags.map((f) => ({ flag: f.flag, status: f.status, mode: f.mode })),
      passports: passports.map((p) => ({ id: p.id, version: p.version, jwtSha256: sha256OfJwt(p.jwt) })),
      decidedAt,
    },
    validFrom: decidedAt,
  });
}

// ---------- Status list credential ----------

export async function signStatusListCredential(repo: Repo, listId = PASSPORT_LIST_ID): Promise<string> {
  const now = new Date().toISOString();
  return signCredential({
    key: await getPlatformKey(),
    types: ["BitstringStatusListCredential"],
    id: statusListUrl(listId),
    subject: {
      id: `${statusListUrl(listId)}#list`,
      type: "BitstringStatusList",
      statusPurpose: "revocation",
      encodedList: await encodedListFor(repo, listId),
    },
    validFrom: now,
  });
}

// ---------- Tamper helper (demo closer) ----------

/**
 * Edit one claim inside credentialSubject WITHOUT re-signing. Header and signature are kept
 * byte-for-byte, so verification must fail with bad_signature.
 * `path` is a dot path, e.g. "components.0.countryOfOrigin".
 */
export function tamperJwt(jwt: string, path: string, value: unknown): string {
  const [h, p, s] = jwt.split(".");
  if (!h || !p || s === undefined) throw new Error("not a compact JWS");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>;
  const subject = payload.credentialSubject as Record<string, unknown> | undefined;
  if (!subject || typeof subject !== "object") throw new Error("JWT has no credentialSubject");
  setPath(subject, path, value);
  return `${h}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
}

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Set an existing claim by dot path. The path is attacker-supplied (demo route), so every segment is
 * validated BEFORE any write: no prototype-reaching segments, own properties only, array indexes numeric.
 */
function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  if (!path || keys.some((k) => !k || FORBIDDEN_SEGMENTS.has(k))) throw new Error(`invalid path: ${path}`);
  let cur: unknown = obj;
  for (const [i, k] of keys.entries()) {
    if (cur === null || typeof cur !== "object") throw new Error(`path not found: ${path}`);
    if (Array.isArray(cur) && !/^\d+$/.test(k)) throw new Error(`path not found: ${path}`);
    if (!Object.hasOwn(cur, k)) throw new Error(`path not found: ${path}`);
    if (i < keys.length - 1) cur = (cur as Record<string, unknown>)[k];
  }
  // All segments exist as own properties; walk again and write the leaf.
  let target = obj as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) target = target[k] as Record<string, unknown>;
  target[keys[keys.length - 1]] = value;
}
