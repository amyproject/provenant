// zod schemas for every request body in contracts/api.ts.
import { z } from "zod";
import { ALL_FLAG_IDS } from "./flags";
import { EVIDENCE_KINDS } from "./extract/schema";

const nonEmpty = z.string().trim().min(1);
const country = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "ISO-3166 alpha-2 country code")
  .transform((s) => s.toUpperCase());
const money = z.number().finite().nonnegative();
const riskTier = z.enum(["low", "medium", "high"]);
const evidenceKind = z.enum(EVIDENCE_KINDS);
const flagId = z.enum(ALL_FLAG_IDS as [string, ...string[]]);

export const AddressSchema = z.object({
  line1: nonEmpty,
  city: nonEmpty,
  state: nonEmpty,
  zip: nonEmpty,
  country,
});

export const EnrollSupplierSchema = z.object({
  legalName: nonEmpty.max(200),
  domain: nonEmpty.max(253),
  address: AddressSchema,
  uei: z.string().trim().min(1).optional(),
  cageCode: z.string().trim().min(1).optional(),
  ein: z.string().trim().min(1).optional(),
  contactEmail: z.email(),
  claimedUsProduction: z.boolean(),
});

/** ~15 MB of PDF once decoded. */
const MAX_BASE64 = 20_000_000;
export const UploadDocumentSchema = z.object({
  kind: evidenceKind,
  filename: nonEmpty.max(255),
  contentType: nonEmpty,
  base64: z
    .string()
    .max(MAX_BASE64, "file too large")
    .regex(/^[A-Za-z0-9+/=\s_-]*$/, "not base64"),
});

export const PassportComponentSchema = z.object({
  name: nonEmpty,
  partNumber: z.string().trim().min(1).optional(),
  supplierName: nonEmpty,
  countryOfOrigin: country,
  costUsd: money,
  childPassportId: z.string().trim().min(1).optional(),
});

export const CreatePassportSchema = z.object({
  supplierId: nonEmpty,
  serialOrBatch: nonEmpty,
  model: nonEmpty,
  spec: z.string(),
  components: z.array(PassportComponentSchema).min(1, "at least one component"),
  testCertificateDocumentIds: z.array(nonEmpty).default([]),
  firmwareVersion: z.string().trim().min(1).optional(),
  prevVersionId: z.string().trim().min(1).optional(),
});

export const VerifySchema = z.object({ jwt: z.string() });

export const CreatePurchaseOrderSchema = z.object({
  supplierId: nonEmpty,
  passportIds: z.array(nonEmpty).min(1, "at least one passport"),
  riskTier,
  amountUsd: z.number().finite().positive(),
  quotedUnitPriceUsd: z.number().finite().positive().optional(),
  quotedLeadTimeDays: z.number().int().nonnegative().optional(),
  buyerPolicyId: z.string().trim().min(1).optional(),
});

export const OverrideSchema = z.object({
  decision: z.enum(["approved", "quarantined", "blocked"]),
  reason: nonEmpty.max(2000),
});

export const TamperSchema = z.object({
  passportId: nonEmpty,
  path: nonEmpty,
  value: z.unknown(),
});

const tierRecord = <T extends z.ZodType>(item: T) => z.object({ low: z.array(item), medium: z.array(item), high: z.array(item) });

export const BuyerPolicySchema = z
  .object({
    id: nonEmpty,
    name: nonEmpty,
    domesticContentThreshold: z.number().min(0).max(1),
    restrictedCountries: z.array(country),
    tierFlags: tierRecord(flagId),
    quarantineAtFlagCount: z.number().int().min(1),
    blockAtFlagCount: z.number().int().min(1),
    tierRequiredEvidence: tierRecord(evidenceKind),
    rechaseIntervalSec: z.number().int().min(0),
    maxChaseAttempts: z.number().int().min(1),
  })
  .refine((p) => p.blockAtFlagCount >= p.quarantineAtFlagCount, {
    message: "blockAtFlagCount must be >= quarantineAtFlagCount",
    path: ["blockAtFlagCount"],
  });

export const AutopilotSchema = z.object({ enabled: z.boolean() });

export const RestorePassportSchema = z.object({ passportId: nonEmpty });
