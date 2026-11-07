# Provenant: autonomous supplier compliance for hard-tech buyers

An AI agent that collects supplier evidence, verifies identity and part origin, signs cryptographic part passports, and
**approves, quarantines or blocks purchase orders on its own**. Hackathon prototype for the YC × Naive "Autonomous Companies" hackathon.

- **App + full README:** [`app/`](app/README.md) (Next.js 16, TypeScript; runs fully offline in demo mode; 182 tests)
- **Architecture & how the agent team built it:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Demo script:** [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) · **Deploy:** [`docs/DEPLOY.md`](docs/DEPLOY.md)

```bash
cd app && npm install && npm run build && npx next start   # http://localhost:3000 → "Run autonomous demo"
```

All companies in the demo are fictional. The Naive integration runs on a stub until the live adapter lands (see the app README's status table).
