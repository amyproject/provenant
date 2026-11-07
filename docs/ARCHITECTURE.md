# Architecture & team plan — Verified US supply chains (working name: **Provenant**)

Owner: **lead**. Source spec: `context/YC Hackathon Autonomous Agents Working Doc.md`. Competitors: `context/competitors.md`.
Event: YC × Naive "Autonomous Companies" hackathon — the product must run **as autonomously as possible** and must use **Naive** (https://usenaive.ai/docs; token not yet available → stub adapter).

## 1. Product thesis (what we build and why)

**Wedge = the spec's Priority 1: an autonomous Supplier Evidence & BOM Compliance agent that ends in an enforced PO decision.**
Supplier-risk / third-party compliance is, in our judgment, the largest-spend segment in the competitor set (Exiger, Interos, Resilinc, Prewave, Altana all sell into it). Market-size numbers must be sourced before they go in the pitch.

Where the incumbents are weak (our judgment from public positioning; validate with buyers):

| Gap in incumbents | Who | What we do instead |
|---|---|---|
| Output is a score/dashboard/alert; a human still decides and chases | Exiger, Interos, Resilinc, Prewave, Altana | Agent **closes the loop**: collect → verify → decide → **block the PO** |
| Evidence collection is surveys + email + PDFs, run by people | Sourcemap, TrusTrace, Resilinc | Agent **requests, chases and ingests** supplier evidence itself (via Naive) until gaps close |
| Proof is a PDF that can be copied or reused | nearly all | **Ed25519-signed VC passports** per part/batch; tamper = verification fails |
| Weak supplier identity / impersonation detection | traceability players | 10 automatic red flags incl. near-copy names, virtual offices, reused certs |
| Enterprise-only, months to deploy; not built for FCC Covered List / Buy American domestic-content tests for hard-tech startups | all | Domestic-content ratio per part, configurable thresholds, minutes to first decision |

## 2. End-to-end autonomous flow (the demo)

```
Buyer creates PO (supplier + passports + risk tier)
  └─► AgentCase starts automatically (no human)
      intake → screening (Loop 1 checks) → gap_analysis
        → requesting  (Naive sends evidence request to supplier)
        → awaiting_supplier (auto re-chase on schedule)
        → ingesting   (Claude extracts PDFs → typed JSON)
        → evaluating  (10 deterministic red-flag rules)
        → deciding    (buyer policy gate: 0 flags approve, 1 quarantine, ≥2 block)
        → signing     (decision record signed)
        → enforcing   (PO approved / quarantined / blocked)
        → monitoring  (Loop 4: change events re-open the case)
      escalated only when the agent cannot proceed
```
Demo outcomes (fictional suppliers only): **A** approved · **B** quarantined (flag 10 undisclosed sub-tier move) · **C** blocked (flags 3, 6, 7). Closer: tamper one claim in A's passport, scan QR, signature fails.

## 3. Stack

Next.js 16 (App Router, TS) · Tailwind 4 + shadcn/ui · Next route handlers as backend · storage behind a repository port (in-memory default, Supabase when env set) · Claude API for extraction/explanations (fixture fallback) · `jose` Ed25519 JWT VCs · vitest.
**Everything must run with zero secrets** (fixture mode) — that is also the cached demo mode. Env vars, all optional: `NAIVE_API_KEY`, `ANTHROPIC_API_KEY`, `SAM_GOV_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SIGNING_PRIVATE_JWK` (generated + persisted to `app/.data/keys.json` if absent).

**Deploy decision (user, 2026-11-07):** one long-running Node host with a persistent disk (Railway/Render/Fly via `app/Dockerfile`), single instance, and `PUBLIC_BASE_URL` for QR codes. See `docs/DEPLOY.md`.

## 4. Interfaces (defined first — `app/src/contracts/`, lead-owned, read-only for everyone else)

- `domain.ts` — entities, flags, policy, agent states/events.
- `api.ts` — every HTTP route, request/response types.
- `naive.ts` — `NaivePort` (send / fetchInbound / parseWebhook). Stub now, live when token arrives.

Need a contract change? **Message the lead** (`SendMessage` to `main`) with the exact diff. Don't edit it yourself, and don't work around it with local look-alike types.

## 5. File ownership (no two agents edit the same file)

| Path (under `app/` unless noted) | Owner |
|---|---|
| `src/contracts/**`, `docs/**` (repo root), `package.json` deps for backend/QA, `.env.example` | **lead** |
| `src/server/**` (repo, crypto, checks, flags, policy, extract, agent, naive), `src/app/api/**`, `data/**` (seed fixtures), `supabase/**` | **backend** |
| `src/app/**` except `src/app/api/**`; `src/components/**`; `src/lib/client/**`; `src/app/globals.css`; `components.json`; UI deps via `npx shadcn add` / `npm install` | **frontend** |
| `tests/**`, `vitest.config.ts`, `team/qa/**` (repo root) | **qa** |
| `team/supervisor/**` (repo root) | **supervisor** (read-only everywhere else) |
| `team/status/<agent>.md` (repo root) | each agent writes only its own file |
| `team/dashboard/collect.mjs`, `lib/**`, `data/progress.json`, `data/history.jsonl` | **dash-collector** (dashboard team) |
| `team/dashboard/server.mjs`, `public/**`, `fixtures/**`, `README.md` | **dash-ui** (dashboard team) |
| `team/dashboard/schema.d.ts`, `data/agents.json` | **lead** |

| `site/**` (repo root) | **website** (marketing team) |
| `deck/**` (repo root) | **deck** (marketing team) |
| `video/**` (repo root) | **video** (marketing team; own app instance on :3300) |
| `docs/marketing/BRIEF.md` | **lead**: single source of truth for all marketing claims |

The dashboard team only reads the build team's files and never messages build-team agents.

`src/lib/utils.ts` and `src/components/ui/button.tsx` were generated by shadcn init → frontend.
Only **frontend** runs `npm install` after kickoff. Backend/QA dependency needs → message lead.

## 6. Dependencies between workstreams

- Frontend does **not** wait for backend: builds against `src/lib/client/api.ts` with mock data from `src/lib/client/mocks.ts` typed by the contracts, switchable with `NEXT_PUBLIC_USE_MOCKS=1`.
- QA does **not** wait: writes contract/behavior tests from the spec first (they fail until backend lands), then turns them green with backend.
- Backend exposes pure functions (`src/server/**`) that QA can unit-test without HTTP.
- Integration (mocks off, full demo run, `next build`) is done by the lead after all three report.

## 7. Coordination protocol

1. Each agent keeps `team/status/<agent>.md` current: done / in progress / blocked / requests-to-lead.
2. Cross-team asks go to the lead, not agent-to-agent.
3. QA files bugs in `team/qa/bugs.md` (id, severity, file:line, repro, owner). Owners fix; QA never edits production code.
4. Supervisor reviews at task-completion checkpoints and reports to the lead; CRITICAL items get escalated to the user by the lead.
