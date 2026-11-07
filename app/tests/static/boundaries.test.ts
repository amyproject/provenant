// Static guards: secrets never reach client code; fixture mode has no hard-coded outbound calls.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../../src");

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(SRC, p);
const isClientFile = (src: string) => /^\s*["']use client["']/m.test(src.slice(0, 200));
const uiFiles = [...walk(join(SRC, "app")), ...walk(join(SRC, "components")), ...walk(join(SRC, "lib"))].filter(
  (p) => !rel(p).startsWith("app/api/"),
);

describe("client/server boundary", () => {
  it("client components never read non-public env vars", () => {
    const offenders: string[] = [];
    for (const f of uiFiles) {
      const src = readFileSync(f, "utf8");
      if (!isClientFile(src) && !rel(f).startsWith("lib/client/")) continue;
      for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        if (!m[1].startsWith("NEXT_PUBLIC_") && m[1] !== "NODE_ENV") offenders.push(`${rel(f)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("client code does not import server modules (keys, repo, SDKs)", () => {
    const offenders: string[] = [];
    for (const f of uiFiles) {
      const src = readFileSync(f, "utf8");
      if (!isClientFile(src) && !rel(f).startsWith("lib/client/")) continue;
      if (/from\s+["'](@\/server|\.\.?\/.*server\/)/.test(src)) offenders.push(`${rel(f)}: imports src/server`);
      if (/from\s+["'](@anthropic-ai\/sdk|@supabase\/supabase-js|node:fs|fs)["']/.test(src)) offenders.push(`${rel(f)}: server-only package`);
    }
    expect(offenders).toEqual([]);
  });

  it("no NEXT_PUBLIC_ variable carries a secret", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      for (const m of readFileSync(f, "utf8").matchAll(/NEXT_PUBLIC_[A-Z0-9_]*(KEY|SECRET|TOKEN|JWK|ROLE)[A-Z0-9_]*/g))
        offenders.push(`${rel(f)}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no hard-coded private keys or API keys in source", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const src = readFileSync(f, "utf8");
      if (/"d"\s*:\s*"[A-Za-z0-9_-]{40,}"/.test(src)) offenders.push(`${rel(f)}: private JWK "d"`);
      if (/sk-ant-[A-Za-z0-9-]{10,}/.test(src)) offenders.push(`${rel(f)}: Anthropic key`);
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(src)) offenders.push(`${rel(f)}: PEM private key`);
    }
    expect(offenders).toEqual([]);
  });
});
