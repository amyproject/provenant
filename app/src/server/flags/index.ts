// Red-flag engine: runs the rules the buyer's policy requires for the PO's risk tier.
import type { FlagId, FlagResult } from "@/contracts";
import {
  f01SignatureInvalid,
  f02TagClone,
  f03ReusedTestCert,
  f04DocMetadataMismatch,
  f05ImportedFinishedGoods,
  f06VirtualOffice,
  f07ImpersonatorName,
  f08PriceLeadtimeOutlier,
  f09BankChangeNoReauth,
  f10UndisclosedSubtierChange,
} from "./rules";
import type { FlagContext, FlagRule } from "./types";

export * from "./rules";
export type { FlagContext, FlagRule, IssuerSample, PriceBaseline, TagChallenge, BankChangeEvent } from "./types";

export const FLAG_RULES: Record<FlagId, FlagRule> = {
  F01_SIGNATURE_INVALID: f01SignatureInvalid,
  F02_TAG_CLONE: f02TagClone,
  F03_REUSED_TEST_CERT: f03ReusedTestCert,
  F04_DOC_METADATA_MISMATCH: f04DocMetadataMismatch,
  F05_IMPORTED_FINISHED_GOODS: f05ImportedFinishedGoods,
  F06_VIRTUAL_OFFICE: f06VirtualOffice,
  F07_IMPERSONATOR_NAME: f07ImpersonatorName,
  F08_PRICE_LEADTIME_OUTLIER: f08PriceLeadtimeOutlier,
  F09_BANK_CHANGE_NO_REAUTH: f09BankChangeNoReauth,
  F10_UNDISCLOSED_SUBTIER_CHANGE: f10UndisclosedSubtierChange,
};

export const ALL_FLAG_IDS = Object.keys(FLAG_RULES) as FlagId[];

/** Evaluate `flagIds` (in canonical F01..F10 order). */
export function evaluateFlags(ctx: FlagContext, flagIds: FlagId[]): FlagResult[] {
  const wanted = new Set(flagIds);
  return ALL_FLAG_IDS.filter((id) => wanted.has(id)).map((id) => FLAG_RULES[id](ctx));
}
