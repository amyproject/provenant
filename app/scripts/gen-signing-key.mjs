#!/usr/bin/env node
// Prints a fresh Ed25519 private JWK for SIGNING_PRIVATE_JWK. With it set, every server instance signs
// and verifies with the same platform key and the same derived per-supplier keys (needed on Vercel).
// Usage: node scripts/gen-signing-key.mjs   (paste the output into the env var, as one line)
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ed25519");
const { kty, crv, d, x } = privateKey.export({ format: "jwk" });
process.stdout.write(`${JSON.stringify({ kty, crv, d, x })}\n`);
