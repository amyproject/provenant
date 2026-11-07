// Seeded evidence documents: specs from data/seed/documents.json rendered to PDFs.
import type { EvidenceKind } from "@/contracts";
import documentsJson from "../../../data/seed/documents.json";
import { sha256Hex } from "../util/ids";
import { makePdf, type PdfSpec } from "./pdf";

interface DocSpecJson {
  id: string;
  supplierId: string;
  kind: string;
  held: boolean;
  filename: string;
  copyOf?: string;
  pdf?: PdfSpec;
  extracted?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SeedDocument {
  id: string;
  supplierId: string;
  kind: EvidenceKind;
  held: boolean;
  filename: string;
  pdf: PdfSpec;
  bytes: Buffer;
  sha256: string;
  extracted: Record<string, unknown>;
  /** Metadata as it would be parsed from the PDF plus seeded extras (templateId). */
  metadata: Record<string, unknown>;
}

let cache: SeedDocument[] | null = null;

export function seedDocuments(): SeedDocument[] {
  if (cache) return cache;
  const specs = documentsJson.documents as DocSpecJson[];
  const byId = new Map(specs.map((s) => [s.id, s]));
  cache = specs.map((s) => {
    // A copy is byte-identical to its source (same hash, same extracted content) under a new filename.
    const src = s.copyOf ? byId.get(s.copyOf) : s;
    if (!src?.pdf) throw new Error(`seed document ${s.id} has no pdf spec`);
    const bytes = makePdf(src.pdf);
    return {
      id: s.id,
      supplierId: s.supplierId,
      kind: s.kind as EvidenceKind,
      held: s.held,
      filename: s.filename,
      pdf: src.pdf,
      bytes,
      sha256: sha256Hex(bytes),
      extracted: src.extracted ?? {},
      metadata: {
        producer: src.pdf.producer,
        author: src.pdf.author,
        title: src.pdf.title,
        creationDate: src.pdf.creationDate,
        ...(src.metadata ?? {}),
      },
    };
  });
  return cache;
}

export const seedDocument = (id: string) => {
  const d = seedDocuments().find((x) => x.id === id);
  if (!d) throw new Error(`unknown seed document ${id}`);
  return d;
};
