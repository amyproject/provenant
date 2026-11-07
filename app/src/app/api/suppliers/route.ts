import type { EnrollSupplierResponse, ListSuppliersResponse } from "@/contracts";
import { handle, readJson } from "@/server/http";
import { enrollSupplier, listSupplierSummaries } from "@/server/services/suppliers";
import { EnrollSupplierSchema } from "@/server/validation";

/** Live store data: never prerender or cache. */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async (): Promise<ListSuppliersResponse> => listSupplierSummaries());
}

/** Enroll: runs Loop 1 checks synchronously; signs a supplier credential if none flag. */
export async function POST(req: Request) {
  return handle(req, async (): Promise<EnrollSupplierResponse> => enrollSupplier(await readJson(req, EnrollSupplierSchema)), 201);
}
