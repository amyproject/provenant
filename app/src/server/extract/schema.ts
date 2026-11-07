import { z } from "zod";

export const EVIDENCE_KINDS = [
  "certificate_of_origin",
  "test_report",
  "certificate_of_conformance",
  "facility_attestation",
  "bom",
  "other",
] as const;

/** Typed fields extracted from an evidence PDF (Claude structured output, or fixture). */
export const ExtractedFieldsSchema = z.object({
  documentType: z.enum(EVIDENCE_KINDS),
  certNumber: z.string().nullable(),
  issuer: z.string().nullable(),
  issuedDate: z.string().nullable().describe("YYYY-MM-DD"),
  expiryDate: z.string().nullable().describe("YYYY-MM-DD"),
  subjectCompany: z.string().nullable().describe("Company the document is about (client / supplier / manufacturer)"),
  facilityAddress: z.string().nullable(),
  model: z.string().nullable(),
  serialOrBatch: z.string().nullable(),
  countryOfOrigin: z.string().nullable().describe("ISO-3166 alpha-2 of the final article, if stated"),
  components: z.array(
    z.object({
      name: z.string(),
      supplierName: z.string().nullable(),
      countryOfOrigin: z.string().nullable().describe("ISO-3166 alpha-2"),
    }),
  ),
  disclosedSubtierChanges: z
    .array(
      z.object({
        component: z.string(),
        fromCountry: z.string().nullable(),
        toCountry: z.string().nullable(),
      }),
    )
    .describe("Sub-tier supplier or origin changes the document explicitly discloses; empty if none or 'none declared'"),
  summary: z.string().describe("One sentence, plain English"),
});

export type ExtractedFields = z.infer<typeof ExtractedFieldsSchema>;
