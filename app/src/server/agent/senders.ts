// Inbound sender verification: evidence is only accepted from the case supplier's contact address
// (or another mailbox on the same domain). Anything else is ignored and logged.
import type { Supplier } from "@/contracts";

/** "Ops <ops@acme.example>" -> "ops@acme.example" */
export function senderAddress(from: string): string {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

export function senderMatchesSupplier(from: string, supplier: Pick<Supplier, "contactEmail">): boolean {
  const addr = senderAddress(from);
  const contact = supplier.contactEmail.trim().toLowerCase();
  if (addr === contact) return true;
  const domain = (e: string) => e.split("@")[1] ?? "";
  return domain(addr) !== "" && domain(addr) === domain(contact);
}
