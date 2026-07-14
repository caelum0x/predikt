# 3-Day Plan (deadline Jul 17, 23:59 UTC)

## Day 1 — Mon Jul 14 (today)
- [x] Pick ONE idea and lock it — **Predikt Oracle**: full agent-native
      prediction market ASP (Finance category), built in `asp/` from predikt's
      AI market factory + a new CPMM engine. 59 tests green, live journey
      verified end-to-end.
- [ ] Set up OKX Agentic Wallet  ← USER ACTION, do tonight
- [ ] Install OnchainOS skill: `npx skills add https://github.com/okx/onchainos-skills --skill okx-ai-guide`
- [ ] Walk the registration flow with the running service to learn review
      requirements BEFORE the real submission
- [ ] Deploy the service to a public URL (Fly.io/Render/Railway)

## Day 1 progress log (evening)
- [x] Workflow 1 (6 parallel agents): x402 deposits (real EIP-3009 verification,
      X Layer config), reputation/Brier leaderboard, activity feed + portfolio,
      MCP server (12 tools), web dashboard at /app, autonomous trader bot.
      Integrated, 146 tests green, committed (0dfb9fa).
- [~] Workflow 2 (running): multi-outcome markets → limit orders →
      adversarial review panel (correctness/security/typescript) → fixes.

## Day 2 — Tue Jul 15  ⚠️ real deadline for listing
- [ ] Build the real endpoint — free tier first, works end-to-end
- [ ] Add x402 paid tier if time allows (strengthens Revenue Rocket / category
      "performance"; free is still eligible)
- [ ] **Submit the ASP listing by end of day** (starts the 24h review clock
      with buffer for a rejection + resubmit)

## Day 3 — Wed Jul 16 (while review runs)
- [ ] Record ≤90s demo: agent calls ASP end-to-end, incl. payment if paid
- [ ] Draft X post with #OKXAI (product story / use case / walkthrough)
- [ ] Prep Google form answers
- [ ] If review bounces → fix and resubmit IMMEDIATELY

## Day 4 — Thu Jul 17 (buffer; done by ~20:00 UTC)
- [ ] Confirm ASP is approved and LIVE on the marketplace
- [ ] Publish X post; verify link works logged-out
- [ ] Submit Google form (ASP details + X post link)
- [ ] Sanity-check every link in the form

## Risks
- Listing not approved in time → submission invalid. Mitigation: submit Jul 15,
  stub-run the flow today.
- x402 integration friction → ship free endpoint first, add payment after.
- ASP tutorial page (okx.ai/tutorial/asp) blocks bots → read it manually in a
  browser today and note any requirements not captured in resources.md.
