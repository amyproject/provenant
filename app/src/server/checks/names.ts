// Pure helpers for company-name comparison (red flag 7, sanctions screening, fixture lookups).
import { distance } from "fastest-levenshtein";

const SUFFIXES = new Set([
  "inc", "incorporated", "llc", "l l c", "ltd", "limited", "corp", "corporation", "co", "company",
  "plc", "gmbh", "fze", "lp", "llp",
]);

/** Lowercase, strip punctuation and legal suffixes: "Halvorsen Ridge Actuators, Inc." -> "halvorsen ridge actuators". */
export function normalizeCompanyName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** Normalized Levenshtein similarity in [0, 1] on normalized names. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeCompanyName(a);
  const y = normalizeCompanyName(b);
  if (!x || !y) return 0;
  const max = Math.max(x.length, y.length);
  return 1 - distance(x, y) / max;
}

/** Near-copy threshold: catches pluralisation, dropped punctuation, one- or two-letter typos. */
export const NEAR_COPY_THRESHOLD = 0.85;

export function normalizeAddressKey(line1: string, zip: string): string {
  return `${line1.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim()}|${zip.trim().slice(0, 5)}`;
}

export const normalizeDomain = (d: string) =>
  d.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/** Exact-entity key: lowercase, punctuation stripped, legal suffix KEPT ("Keystone Actuation Co." != "... Inc."). */
export const strictCompanyKey = (name: string) =>
  name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).join(" ");

interface AddressParts {
  house: string | null;
  street: string | null;
  units: Set<string>;
}

/** House number, first street word and unit numbers ("#214", "Ste 214", "Suite 214", "PMB 214" -> "214"). */
export function addressParts(line: string): AddressParts {
  const lower = line.toLowerCase();
  const units = new Set<string>();
  for (const m of lower.matchAll(/(?:#|\b(?:ste|suite|unit|pmb|apt|room|rm|box)\b\.?)\s*([a-z0-9-]+)/g)) units.add(m[1]);
  const tokens = lower.replace(/[^a-z0-9#]+/g, " ").trim().split(/\s+/);
  const house = tokens[0] && /^\d+[a-z]?$/.test(tokens[0]) ? tokens[0] : null;
  return { house, street: house ? (tokens[1] ?? null) : null, units };
}

/**
 * True when `candidate` names the same street address as `mailbox`, ignoring formatting
 * ("77 Commerce St #214" == "77 Commerce Street, Suite 214, Wilmington"). Used by flag 6 to reject
 * "facility" evidence that just repeats a virtual-office address.
 */
export function sameStreetAddress(mailbox: string, candidate: string): boolean {
  const a = addressParts(mailbox);
  const b = addressParts(candidate);
  if (!a.house || a.house !== b.house || a.street !== b.street) return false;
  return [...a.units].every((u) => b.units.has(u));
}
