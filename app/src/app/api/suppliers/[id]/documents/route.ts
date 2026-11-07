import type { UploadDocumentResponse } from "@/contracts";
import { handle, readJson } from "@/server/http";
import { uploadDocument } from "@/server/services/suppliers";
import { UploadDocumentSchema } from "@/server/validation";

/** Upload evidence (base64 JSON). Claude extracts typed fields when live; fixture extraction otherwise. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, async (): Promise<UploadDocumentResponse> => {
    const { id } = await params;
    return uploadDocument(id, await readJson(req, UploadDocumentSchema), "upload");
  }, 201);
}
