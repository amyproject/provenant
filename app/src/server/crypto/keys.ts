// Ed25519 key management. The platform key signs supplier credentials, decision records and the
// status list; each supplier has its own key that signs its part passports ("signed at manufacture").
// Hackathon: keys are custodial and persisted to app/.data/keys.json (or SIGNING_PRIVATE_JWK for the
// platform key). Production: KMS/HSM, and supplier keys never leave the supplier.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { exportJWK, generateKeyPair, importJWK, type CryptoKey, type JWK } from "jose";
import { env } from "../env";

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
};

const keyFilePath = () => `${env.dataDir()}/keys.json`;

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
  if (env.persist() && existsSync(keyFilePath())) {
    try {
      file = JSON.parse(readFileSync(keyFilePath(), "utf8")) as KeyFile;
      file.suppliers ??= {};
    } catch (err) {
      console.warn("[keys] unreadable keys.json, generating new keys:", err);
    }
  }
  g.__provenantKeys = file;
  return file;
}

function saveFile(file: KeyFile) {
  if (!env.persist()) return;
  mkdirSync(dirname(keyFilePath()), { recursive: true });
  writeFileSync(keyFilePath(), JSON.stringify(file, null, 2), { mode: 0o600 });
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
  const envJwk = process.env.SIGNING_PRIVATE_JWK?.trim();
  if (envJwk) {
    const privateJwk = JSON.parse(envJwk) as JWK;
    if (privateJwk.kty !== "OKP" || privateJwk.crv !== "Ed25519" || !privateJwk.d) {
      throw new Error("SIGNING_PRIVATE_JWK must be an Ed25519 OKP private JWK");
    }
    const did = platformDid();
    return { did, kid: `${did}#key-1`, privateJwk, publicJwk: publicFromPrivate(privateJwk) };
  }
  const file = loadFile();
  if (!file.platform) {
    file.platform = await generate(platformDid());
    saveFile(file);
  }
  return withCurrentDid(file.platform, platformDid());
}

export async function getSupplierKey(supplierId: string): Promise<KeyRecord> {
  const file = loadFile();
  if (!file.suppliers[supplierId]) {
    file.suppliers[supplierId] = await generate(supplierDid(supplierId));
    saveFile(file);
  }
  return withCurrentDid(file.suppliers[supplierId], supplierDid(supplierId));
}

/** Public key of a supplier, without creating one. Null = unknown issuer. */
export function findSupplierPublicJwk(supplierId: string): JWK | null {
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
