# Provenant (working name): autonomous supplier compliance for hard-tech buyers

An AI agent that **collects supplier evidence, verifies identity and part origin, signs cryptographic proofs, and blocks bad purchase
orders on its own**. Built for the YC × Naive "Autonomous Companies" hackathon.

Incumbents (Exiger, Interos, Resilinc, Prewave, Altana…) output risk scores and dashboards; a human still chases suppliers and decides.
Provenant closes the loop: **request → chase → verify → decide → sign → enforce → monitor**, with humans only on escalation or override.

## Run it

```bash
npm install
npm run build && npx next start      # http://localhost:3000   (single Node process; see ../docs/DEPLOY.md)
npm test                             # 181 tests, fully offline
```
No secrets needed: with no env vars set, everything runs in fixture/stub mode (that is also the demo mode). See `.env.example`.
Then: Command center → **Run autonomous demo**. Script: `../docs/DEMO_SCRIPT.md`.

## What it does

| Loop | What happens |
|---|---|
| 1 Identity | SAM.gov, sanctions (CSL), USPS virtual-office (CMRA), domain age (RDAP), lookalike names, shipping history → signed supplier credential |
| 2 Part passport | Per-part/batch W3C Verifiable Credential (Ed25519 JWT), component origins and costs, domestic-content ratio, QR verification page |
| 3 Sub-tier | New passport versions are diffed; undisclosed moves to restricted countries are flagged (F10) |
| 4 Monitoring | Approved orders stay watched; a forged/changed passport re-opens the case and quarantines the order automatically |
| 5 Policy gate | Buyer policy per risk tier: 0 flags → approve, 1 → quarantine, ≥2 → block; Buy American threshold configurable |

The **autonomous agent** (`src/server/agent/`) is a state machine driven by a server heartbeat (no clicks): intake → screening → gap
analysis → **requests evidence from the supplier via Naive** → re-chases → ingests replies (Claude extraction) → 10 red-flag rules →
policy → signed decision → enforce → monitor. Unanswered requests escalate to a human after N attempts.

## Honest status: live vs seeded vs simulated

| Piece | Status |
|---|---|
| Red-flag logic, policy gate, signing/verification, agent loop | **Real logic** (fully tested) |
| Identity data sources (SAM, CSL, CMRA, RDAP, ImportYeti) | Fixture data by default; live adapters behind env keys, **not yet run against real services** |
| Claude PDF extraction + explanations | Fixture by default; live with `ANTHROPIC_API_KEY` (untested against the demo outcomes) |
| **Naive** (required by the hackathon) | All agent↔supplier messaging goes through one `NaivePort` (`src/contracts/naive.ts`). **Runs on `StubNaive` today; the live adapter is pending the Naive docs/token.** Setting `NAIVE_API_KEY` shows `live_pending` and keeps the stub running |
| Flag 2 (NFC clone), flag 9 (bank change) | Simulated, as in the spec |
| Storage | In-memory + `DATA_DIR` file persistence; Supabase adapter + `supabase/schema.sql` untested |

## Layout

`src/contracts/` shared types (API, domain, Naive port, demo IDs) · `src/server/` crypto, checks, extraction, flags, policy, agent,
Naive adapters, store · `src/app/api/` routes · `src/app/` + `src/components/` UI · `data/` fictional seed + fixtures · `tests/` vitest.
Built by a 5-agent team; the plan and ownership are in `../docs/ARCHITECTURE.md`.
