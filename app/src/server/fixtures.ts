// Seeded reference data used by the red-flag rules (flags 2, 4, 8, 9).
import issuerSamples from "../../data/fixtures/issuer-samples.json";
import priceBaselines from "../../data/fixtures/price-baselines.json";
import simulated from "../../data/fixtures/simulated-events.json";
import type { BankChangeEvent, IssuerSample, PriceBaseline, TagChallenge } from "./flags";

export const ISSUER_SAMPLES = issuerSamples.issuers as Record<string, IssuerSample>;
export const PRICE_BASELINES = priceBaselines.baselines as PriceBaseline[];
export const PRICE_Z_THRESHOLD = priceBaselines.zScoreThreshold;
export const TAG_CHALLENGES = simulated.tagChallenges as Record<string, TagChallenge>;
export const BANK_CHANGES = simulated.bankChanges as BankChangeEvent[];
