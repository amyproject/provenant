# Shared task list (owner: lead — agents report progress in team/status/<agent>.md)

| ID | Task | Owner | Depends on | Status |
|---|---|---|---|---|
| L1 | Scaffold Next.js + shared deps + shadcn init | lead | — | done |
| L2 | Contracts v2: domain / api / naive port / demo IDs, autopilot | lead | — | done |
| L3 | Naive docs + YC judging criteria → refine NaivePort, pitch emphasis | lead | user-provided pages | blocked (web tools disabled; awaiting pasted docs) |
| L4 | Integration: mocks off, demo run, `next build`, demo script | lead | B*, F*, Q* | done — 180/180 tests, build ✓, deploy-condition smoke ✓ (token, ported URL, tamper→auto-quarantine→restore), DEMO_SCRIPT.md |
| B1 | Repository port + in-memory store (+ Supabase adapter + `supabase/schema.sql`) | backend | L2 | done |
| B2 | Crypto: Ed25519 key mgmt, VC-JWT sign/verify, bitstring status list, tamper helper | backend | L2 | done |
| B3 | Loop 1 identity checks (SAM, CSL, CMRA, RDAP, name similarity, ImportYeti) — fixture + live adapters | backend | B1 | done |
| B4 | Extraction (Claude PDF→JSON, fixture fallback) + flag explanations | backend | B1 | done |
| B5 | Red-flag engine F01–F10, one pure fn each | backend | B2,B4 | done |
| B6 | Policy gate + signed decision record | backend | B5 | done |
| B7 | Autonomous agent state machine + NaivePort stub/live adapters + outbox + re-chase | backend | B3–B6 | done |
| B8 | Seed data: fictional suppliers A/B/C, policy, passports, documents | backend | B2 | done |
| B9 | All API routes in contracts/api.ts | backend | B1–B8 | done |
| F1 | App shell, nav, design system (enterprise look) | frontend | L2 | done (mocks; real-API smoke pending L4) |
| F2 | Typed API client + mocks | frontend | L2 | done (mocks; real-API smoke pending L4) |
| F3 | Command center dashboard: suppliers, POs, decisions, "Run autonomous demo" | frontend | F2 | done (mocks; real-API smoke pending L4) |
| F4 | PO detail: decision, flags w/ explanations, live agent timeline | frontend | F2 | done (mocks; real-API smoke pending L4) |
| F5 | Agent operations console: all cases, events stream, outbox (Naive) | frontend | F2 | done (mocks; real-API smoke pending L4) |
| F6 | Supplier list/detail/enroll + document upload | frontend | F2 | done (mocks; real-API smoke pending L4) |
| F7 | Public passport verify page + QR (`/verify/[passportId]`), tamper demo | frontend | F2 | done (mocks; real-API smoke pending L4) |
| F8 | Settings: integration status (Naive token), buyer policy editor | frontend | F2 | done (mocks; real-API smoke pending L4) |
| Q1 | vitest config + unit tests: crypto, flags, policy | qa | L2 | done (182/182; 9/9 bugs fixed) |
| Q2 | Agent state machine tests (happy path, re-chase, escalation) | qa | L2 | done (182/182; 9/9 bugs fixed) |
| Q3 | API route tests + end-to-end demo scenario (A/B/C + tamper) | qa | L2 | done (182/182; 9/9 bugs fixed) |
| Q4 | Code review of backend + frontend; bugs in team/qa/bugs.md | qa | B*, F* | done (182/182; 9/9 bugs fixed) |
| S1 | Supervisor checkpoint reviews → team/supervisor/report-N.md | supervisor | each completion | done (reports 1–4) |
