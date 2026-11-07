import { createHash, randomBytes } from "node:crypto";

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString("hex")}`;

export const nowIso = () => new Date().toISOString();

export const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
