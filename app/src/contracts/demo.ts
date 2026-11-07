// Fixed demo identities shared by backend seed and frontend mocks so they cannot drift. OWNER: lead.
// Domains use the reserved .example TLD (RFC 2606) so no real company or live lookup is ever implicated.
// All companies are fictional (public demo; naming a real company as fraudulent is a legal risk).

import type { RiskTier } from "./domain";

export const DEMO = {
  A: {
    supplierId: "sup_A",
    legalName: "Keystone Actuation Inc.",
    domain: "keystoneactuation.example",
    contactEmail: "compliance@keystoneactuation.example",
    riskTier: "high" as RiskTier,
    expected: "approved",
    // Seeded missing a facility attestation: the agent must request it via Naive and ingest the reply.
    story: "Legit US actuator maker; agent requests a missing facility attestation, supplier replies, all checks pass.",
  },
  B: {
    supplierId: "sup_B",
    legalName: "Midland Motion Assembly LLC",
    domain: "midlandmotion.example",
    contactEmail: "quality@midlandmotion.example",
    riskTier: "high" as RiskTier,
    expected: "quarantined",
    story: "US assembler; agent requests the current sub-tier BOM, the reply's new passport version moves the reducer to a restricted country undisclosed (F10).",
  },
  C: {
    supplierId: "sup_C",
    legalName: "Keystone Actuation Co.", // near-copy of A
    domain: "keystone-actuation.example",
    contactEmail: "sales@keystone-actuation.example",
    riskTier: "high" as RiskTier,
    expected: "blocked",
    story: "Impersonator: near-copy name + new domain (F07), CMRA virtual office (F06), reuses A's test certificate (F03).",
  },
} as const;

export type DemoLabel = keyof typeof DEMO;
export const DEMO_POLICY_ID = "pol_default";
