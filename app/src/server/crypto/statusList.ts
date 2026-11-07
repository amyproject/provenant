// W3C Bitstring Status List (revocation). Bit i set = credential with statusListIndex i is revoked.
// The list is published as a platform-signed BitstringStatusListCredential at /api/status-lists/:id.
import { gunzipSync, gzipSync } from "node:zlib";
import { env } from "../env";
import type { Repo, StoredStatusList } from "../repo";

/** Spec minimum: 16KB uncompressed (131,072 entries) for herd privacy. */
export const STATUS_LIST_SIZE = 131_072;
export const PASSPORT_LIST_ID = "passports";

export const statusListUrl = (listId: string) => `${env.publicBaseUrl()}/api/status-lists/${listId}`;

export function statusEntry(listId: string, index: number) {
  return {
    id: `${statusListUrl(listId)}#${index}`,
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: String(index),
    statusListCredential: statusListUrl(listId),
  };
}

/** gzip + base64url with the multibase "u" prefix, per the spec's encodedList. */
export function encodeBitstring(setIndices: number[], size = STATUS_LIST_SIZE): string {
  const bytes = new Uint8Array(size / 8);
  for (const i of setIndices) {
    if (i < 0 || i >= size) continue;
    bytes[i >> 3] |= 0x80 >> (i & 7); // most-significant bit first
  }
  return `u${gzipSync(bytes).toString("base64url")}`;
}

export function isBitSet(encodedList: string, index: number): boolean {
  const raw = gunzipSync(Buffer.from(encodedList.replace(/^u/, ""), "base64url"));
  return ((raw[index >> 3] ?? 0) & (0x80 >> (index & 7))) !== 0;
}

async function getList(repo: Repo, listId: string): Promise<StoredStatusList> {
  return (
    (await repo.statusLists.get(listId)) ?? { id: listId, purpose: "revocation", nextIndex: 0, revokedIndices: [] }
  );
}

export async function allocateStatusIndex(repo: Repo, listId = PASSPORT_LIST_ID): Promise<number> {
  const list = await getList(repo, listId);
  const index = list.nextIndex;
  await repo.statusLists.put({ ...list, nextIndex: index + 1 });
  return index;
}

export async function revokeStatusIndex(repo: Repo, index: number, listId = PASSPORT_LIST_ID): Promise<void> {
  const list = await getList(repo, listId);
  if (!list.revokedIndices.includes(index)) list.revokedIndices.push(index);
  await repo.statusLists.put(list);
}

export async function isRevoked(repo: Repo, index: number, listId = PASSPORT_LIST_ID): Promise<boolean> {
  const list = await getList(repo, listId);
  return list.revokedIndices.includes(index);
}

export async function encodedListFor(repo: Repo, listId = PASSPORT_LIST_ID): Promise<string> {
  return encodeBitstring((await getList(repo, listId)).revokedIndices);
}
