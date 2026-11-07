# Deploy (decision: ONE Node host with a persistent disk)

Why: the store and Ed25519 keys live on disk (`DATA_DIR`), and the agent autopilot is an in-process heartbeat.
Several instances or serverless runtimes would split the memory store and keys, so genuine passports could fail verification.

Railway or Fly (always-on) using `app/Dockerfile`. Avoid Render's free tier: it has no disk and it sleeps, which stops the autopilot.
The image has never been built here (no docker daemon), so build it once on the target before demo day.
1. Service from `supply_chain/app`, Dockerfile build, **1 instance**, no autoscaling.
2. Persistent volume mounted at `/data`.
3. Env: `PUBLIC_BASE_URL=https://<your-host>` (QR codes point here), `DEMO_ADMIN_TOKEN=<random>` (locks the demo-mutating routes on a public URL),
   optional `SIGNING_PRIVATE_JWK` (pins keys across volume loss), and `NAIVE_API_KEY` once the live adapter exists.
   **Do NOT set `ANTHROPIC_API_KEY` on the demo host** until the A/B/C outcomes have been re-verified with live extraction.
   Keep `DEMO_ADMIN_TOKEN` set even for local rehearsals.
4. After EVERY deploy, reset (the persisted db.json keeps the old seed):
   `curl -X POST -H "x-demo-token: $DEMO_ADMIN_TOKEN" https://<host>/api/demo/reset`
5. Presenter: enter the token in `/settings` before going on stage (otherwise a prompt pops up mid-demo). Don't reset while cases are mid-step.

Local equivalent: `cd app && npm run build && npx next start`.
