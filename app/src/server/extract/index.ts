// Evidence extraction + plain-English explanations.
// Live (ANTHROPIC_API_KEY): Claude reads the PDF into typed JSON (zod-validated) and writes explanations.
// Fixture: deterministic extraction keyed by file sha256, then filename, then a text heuristic.
import type { EvidenceKind, FlagResult, Supplier } from "@/contracts";
import { seedDocuments } from "../seed/documents";
import { sha256Hex } from "../util/ids";
import { claudeExtract, claudeText } from "./claude";
import { extractPdfText, parsePdfMetadata } from "./pdf";
import { EVIDENCE_KINDS, ExtractedFieldsSchema, type ExtractedFields } from "./schema";

export { ExtractedFieldsSchema, type ExtractedFields } from "./schema";
export { parsePdfMetadata, extractPdfText } from "./pdf";

export interface ExtractionInput {
  kind: EvidenceKind;
  filename: string;
  contentType: string;
  base64: string;
}

export interface ExtractionOutput {
  sha256: string;
  extracted: Record<string, unknown>;
  metadata: Record<string, unknown>;
  source: "claude" | "fixture" | "heuristic";
}

const emptyFields = (kind: EvidenceKind, summary: string): ExtractedFields => ({
  documentType: kind,
  certNumber: null,
  issuer: null,
  issuedDate: null,
  expiryDate: null,
  subjectCompany: null,
  facilityAddress: null,
  model: null,
  serialOrBatch: null,
  countryOfOrigin: null,
  components: [],
  disclosedSubtierChanges: [],
  summary,
});

/** Fixture lookup: exact file hash first, then filename. */
export function fixtureExtraction(sha256: string, filename: string) {
  const docs = seedDocuments();
  return docs.find((d) => d.sha256 === sha256) ?? docs.find((d) => d.filename === filename) ?? null;
}

/** "Key: Value" lines from simple PDFs -> fields. Used for unknown uploads in fixture mode. */
export function heuristicExtraction(kind: EvidenceKind, lines: string[]): ExtractedFields {
  const get = (...keys: string[]) => {
    for (const line of lines) {
      const m = /^\s*([A-Za-z/ ()]+?)\s*:\s*(.+)$/.exec(line);
      if (m && keys.some((k) => m[1].toLowerCase().startsWith(k))) return m[2].trim();
    }
    return null;
  };
  const fields = emptyFields(kind, lines.length ? `${lines[0]}`.slice(0, 200) : "No machine-readable text found; stored for manual review.");
  fields.certNumber = get("certificate no", "cert no", "certificate number", "report no");
  fields.issuer = get("issuer", "issued by", "laboratory");
  fields.issuedDate = get("issued", "date");
  fields.subjectCompany = get("client", "supplier", "company", "manufacturer");
  fields.facilityAddress = get("facility", "address");
  fields.model = get("model");
  fields.serialOrBatch = get("serial", "batch", "lot");
  const origin = get("country of origin");
  fields.countryOfOrigin = origin ? (/\b([A-Z]{2})\b/.exec(origin)?.[1] ?? null) : null;
  return fields;
}

export async function extractDocument(input: ExtractionInput): Promise<ExtractionOutput> {
  const bytes = Buffer.from(input.base64, "base64");
  const sha256 = sha256Hex(bytes);
  const metadata: Record<string, unknown> = { ...parsePdfMetadata(bytes), contentType: input.contentType };

  if (input.contentType === "application/pdf" || metadata.isPdf) {
    const live = await claudeExtract({ base64: input.base64, filename: input.filename, kindHint: input.kind });
    if (live) return { sha256, extracted: live, metadata, source: "claude" };
  }
  const fixture = fixtureExtraction(sha256, input.filename);
  if (fixture) return { sha256, extracted: fixture.extracted, metadata: { ...metadata, ...fixture.metadata }, source: "fixture" };
  return { sha256, extracted: heuristicExtraction(input.kind, extractPdfText(bytes)), metadata, source: "heuristic" };
}

export const isEvidenceKind = (k: unknown): k is EvidenceKind => (EVIDENCE_KINDS as readonly unknown[]).includes(k);

/** Re-validate stored extraction (e.g. before trusting it in a rule). */
export const parseExtracted = (x: unknown) => ExtractedFieldsSchema.safeParse(x);

// ---------- Explanations ----------

const EXPLAIN_SYSTEM = [
  "You explain supply-chain compliance red flags to a procurement manager.",
  "Two or three plain-English sentences: what was found, why it matters, what would clear it.",
  "Use only the facts in the evidence. Do not change the verdict; a deterministic rule already decided it.",
].join(" ");

/** Claude-written explanation in live mode; the rule's template explanation otherwise. */
export async function explainFlag(flag: FlagResult, supplier: Pick<Supplier, "legalName">): Promise<string> {
  if (flag.status !== "flag") return flag.explanation;
  const text = await claudeText(
    EXPLAIN_SYSTEM,
    `Supplier: ${supplier.legalName}\nRed flag: ${flag.flag}\nRule output: ${flag.explanation}\nEvidence JSON: ${JSON.stringify(flag.evidence).slice(0, 4000)}`,
    400,
  );
  return text ?? flag.explanation;
}
