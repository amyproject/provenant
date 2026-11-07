// Ed25519 key management. The platform key signs supplier credentials, decision records and the
// status list; each supplier has its own key that signs its part passports ("signed at manufacture").
//
// Key sources, in order:
//   1. SIGNING_PRIVATE_JWK set: it is the platform key, and every supplier key is DERIVED from it
//      (HKDF-SHA256 over the supplier id -> Ed25519 seed), so all serverless instances agree.
//   2. Shared Redis configured: same derivation from a random master seed stored once in Redis (SET NX).
//   3. Otherwise: random keys persisted to DATA_DIR/keys.json (single host). Persistence failures are
//      logged once and keys stay in memory ("ephemeral").
// Production: KMS/HSM, and supplier keys never leave the supplier.
import { createPrivateKey, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { exportJWK, generateKeyPair, importJWK, type CryptoKey, type JWK } from "jose";
import { env, warnOnce } from "../env";
import { getRedis, redisKey } from "../redis";

export const SIGNING_ALG = "EdDSA";

export interface KeyRecord {
  did: string;
  kid: string;
  publicJwk: JWK;
  privateJwk: JWK;
}

interface KeyFile {
  platform?: KeyRecord;
  suppliers: Record<string, KeyRecord>;
}

const g = globalThis as unknown as {
  __provenantKeys?: KeyFile;
  __provenantKeyCache?: Map<string, CryptoKey | Uint8Array>;
  __provenantKeySaveFailed?: boolean;
  __provenantMaster?: Promise<Buffer | null>;
  __provenantDerived?: Map<string, { publicJwk: JWK; privateJwk: JWK }>;
};

const keyFilePath = () => {
  const dir = env.dataDir();
  return dir ? `${dir}/keys.json` : null;
};

/** did:web method-specific id for our host: per the did:web spec a port's ":" is percent-encoded (localhost%3A3000). */
function didHost(): string {
  try {
    return encodeURIComponent(new URL(env.publicBaseUrl()).host);
  } catch {
    return "provenant.local";
  }
}

export const platformDid = () => `did:web:${didHost()}`;
export const supplierDid = (supplierId: string) => `did:web:${didHost()}:suppliers:${supplierId}`;

/**
 * Inverse of supplierDid; null if the DID is not one of our supplier DIDs. Host-agnostic and accepts both
 * the spec form (host%3A3000) and a legacy unencoded port (host:3000), so passports signed under another
 * PUBLIC_BASE_URL still resolve to the right supplier key.
 */
export function supplierIdFromDid(did: unknown): string | null {
  if (typeof did !== "string") return null;
  const m = /^did:web:[^:]+(?::\d+)?:suppliers:([A-Za-z0-9_-]+)$/.exec(did);
  return m ? m[1] : null;
}

/** Re-derive did/kid from the current host so records persisted under an older base URL stay spec-valid. */
function withCurrentDid(rec: KeyRecord, did: string): KeyRecord {
  return rec.did === did ? rec : { ...rec, did, kid: `${did}#key-1` };
}

function loadFile(): KeyFile {
  if (g.__provenantKeys) return g.__provenantKeys;
  let file: KeyFile = { suppliers: {} };
  const path = keyFilePath();
  if (env.persist() && path && existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, "utf8")) as KeyFile;
      file.suppliers ??= {};
    } catch (err) {
      warnOnce("keys-read", "unreadable keys.json, generating new keys:", err);
    }
  }
  g.__provenantKeys = file;
  return file;
}

function saveFile(file: KeyFile) {
  const path = keyFilePath();
  if (!env.persist() || !path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(file, null, 2), { mode: 0o600 });
  } catch (err) {
    g.__provenantKeySaveFailed = true;
    warnOnce("keys-write", `could not persist ${path}; signing keys are in-memory only (ephemeral):`, err);
  }
}

/** Master secret for deterministic key derivation (JWK "d", or a seed shared via Redis), else null. */
function masterSecret(): Promise<Buffer | null> {
  g.__provenantMaster ??= (async () => {
    const jwk = envJwk();
    if (jwk) return Buffer.from(jwk.d!, "base64url");
    const redis = getRedis();
    if (!redis) return null;
    const key = redisKey("keys:master-seed");
    // First instance wins; everyone then reads the same seed.
    await redis.set(key, randomBytes(32).toString("base64url"), { nx: true });
    const seed = await redis.get(key);
    if (!seed) throw new Error("could not read the shared signing seed from Redis");
    return Buffer.from(seed, "base64url");
  })().catch((err) => {
    g.__provenantMaster = undefined;
    throw err;
  });
  return g.__provenantMaster;
}

/** PKCS#8 DER prefix for a raw 32-byte Ed25519 private key (RFC 8410). */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Ed25519 key pair deterministically derived from the master secret for a label ("platform", "supplier:<id>"). */
export function deriveEd25519(master: Buffer, label: string): { publicJwk: JWK; privateJwk: JWK } {
  const cacheKey = `${master.toString("base64url").slice(0, 16)}:${label}`;
  g.__provenantDerived ??= new Map();
  const hit = g.__provenantDerived.get(cacheKey);
  if (hit) return hit;
  const seed = Buffer.from(hkdfSync("sha256", master, "provenant-ed25519-v1", label, 32));
  const privateJwk = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" }).export({
    format: "jwk",
  }) as JWK;
  const out = { privateJwk, publicJwk: publicFromPrivate(privateJwk) };
  g.__provenantDerived.set(cacheKey, out);
  return out;
}

function envJwk(): JWK | null {
  const raw = process.env.SIGNING_PRIVATE_JWK?.trim();
  if (!raw) return null;
  const jwk = JSON.parse(raw) as JWK;
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.d || !jwk.x) {
    throw new Error("SIGNING_PRIVATE_JWK must be an Ed25519 OKP private JWK (kty, crv, d, x)");
  }
  return jwk;
}

/** "persistent" when every instance/restart signs with the same keys; "ephemeral" otherwise. */
export function signingKeysMode(): "persistent" | "ephemeral" {
  if (process.env.SIGNING_PRIVATE_JWK?.trim() || getRedis()) return "persistent";
  if (env.serverless() || !env.persist() || !env.dataDir() || g.__provenantKeySaveFailed) return "ephemeral";
  return "persistent";
}

async function generate(did: string): Promise<KeyRecord> {
  const { publicKey, privateKey } = await generateKeyPair(SIGNING_ALG, { crv: "Ed25519", extractable: true });
  return { did, kid: `${did}#key-1`, publicJwk: await exportJWK(publicKey), privateJwk: await exportJWK(privateKey) };
}

function publicFromPrivate(jwk: JWK): JWK {
  const { kty, crv, x } = jwk;
  return { kty, crv, x };
}

export async function getPlatformKey(): Promise<KeyRecord> {
  const did = platformDid();
  const jwk = envJwk();
  if (jwk) return { did, kid: `${did}#key-1`, privateJwk: jwk, publicJwk: publicFromPrivate(jwk) };
  const master = await masterSecret();
  if (master) return { did, kid: `${did}#key-1`, ...deriveEd25519(master, "platform") };
  const file = loadFile();
  if (!file.platform) {
    file.platform = await generate(did);
    saveFile(file);
  }
  return withCurrentDid(file.platform, did);
}

export async function getSupplierKey(supplierId: string): Promise<KeyRecord> {
  const did = supplierDid(supplierId);
  const master = await masterSecret();
  if (master) return { did, kid: `${did}#key-1`, ...deriveEd25519(master, `supplier:${supplierId}`) };
  const file = loadFile();
  if (!file.suppliers[supplierId]) {
    file.suppliers[supplierId] = await generate(did);
    saveFile(file);
  }
  return withCurrentDid(file.suppliers[supplierId], did);
}

/** Public key of a supplier, without creating one. Null = unknown issuer (file mode). */
export async function findSupplierPublicJwk(supplierId: string): Promise<JWK | null> {
  const master = await masterSecret();
  if (master) return deriveEd25519(master, `supplier:${supplierId}`).publicJwk;
  return loadFile().suppliers[supplierId]?.publicJwk ?? null;
}

export async function importKey(jwk: JWK): Promise<CryptoKey | Uint8Array> {
  const cacheKey = `${jwk.x}:${jwk.d ? "priv" : "pub"}`;
  g.__provenantKeyCache ??= new Map();
  const hit = g.__provenantKeyCache.get(cacheKey);
  if (hit) return hit;
  const key = await importJWK(jwk, SIGNING_ALG);
  g.__provenantKeyCache.set(cacheKey, key);
  return key;
}
