# Demo script (~3 min). All companies are fictional.

**Immediately before going on stage**
- `POST /api/demo/reset` with the token. **Reset right before, then press Run exactly once.** Rehearsals leave duplicate POs.
- Open `/settings` and enter the demo token. Confirm the top bar reads "Autopilot ON".
- Second tab: `/verify/pp_A_1?presenter=1` (tamper and restore controls show only here). Phone ready to scan its QR code.
- Demo host runs **without** `ANTHROPIC_API_KEY` (fixture extraction is the tested path).

1. **Problem (20s).** FCC Covered List (July 2026) + Buy American: hard-tech buyers must prove US origin, but verification is manual,
   one-time and PDF-based. Incumbents (Exiger, Interos, Resilinc, Prewave…) give you a *score*. A human still chases suppliers and decides.
2. **Run (10s).** Command center → **Run autonomous demo**, once. Then take your hands off the keyboard.
3. **Watch the agent work (60s).** Open `/agent`. In about 10s, with no clicks:
   - It screens all 3 suppliers across 6 identity sources, finds one evidence gap each, and **writes and sends each supplier an evidence
     request through our Naive integration**. Say it straight: *"Naive is wired in through one port; today it runs on the stub
     because our token hasn't arrived. The badge on screen says so."*
   - It ingests the replies (timeline shows "(fixture)" extraction in demo mode; Claude reads the PDFs when the key is set), runs 10
     deterministic red-flag rules and applies the buyer policy.
   - **A approved** · **B quarantined**: the new passport version moves the reducer to a restricted country without disclosure (F10)
     · **C blocked**: a lookalike of A's name on a weeks-old domain (F07), a mailbox address posing as a factory (F06), and A's test
     certificate reused (F03).
   - Every decision is **signed** (W3C VC, Ed25519). "AI extracts and explains, rules decide, cryptography proves."
4. **The closer (45s).** In the presenter tab, click **"Relabel a foreign component as US-made"**: A's Japanese magnet set becomes
   "US". Scan the QR on the phone: **SIGNATURE INVALID**, with the relabeled field highlighted ("signed by issuer: JP · presented now: US").
   Switch to the command center: **the agent has already quarantined A on its own** (Loop 4 monitoring, ~5s).
   Back in the presenter tab, click **Restore**: the agent re-verifies and re-approves A.
5. **Close (20s).** Suppliers enroll once and reuse the credential across buyers. Wedge: physical-AI companies facing the FCC test.

Say plainly that signatures prove *who* made a claim and that it wasn't altered, not that the claim is true. Cross-checks carry that weight.

**Backup:** keep a screen recording of a full run in case the network or phone fails, and a phone hotspot in case venue Wi-Fi blocks the QR.
