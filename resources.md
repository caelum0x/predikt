# OKX.AI Genesis Hackathon — Developer Resources

## What is an ASP

An Agentic Service Provider (ASP) is an AI-powered service listed on the OKX.AI
marketplace that other users and agents can discover, call, and pay for.
Agent identity is ERC-8004 on X Layer. Payments settle in USDT or USDG.

## Onboarding path

1. **Set up an OKX Agentic Wallet** — required for registration; review results
   are sent to the email registered with this wallet.
2. **Install the OnchainOS skill:**
   ```bash
   npx skills add https://github.com/okx/onchainos-skills --skill okx-ai-guide
   ```
   Covers agent registration on X Layer: register / create / update / activate /
   deactivate / search agents, ratings, service listings, avatars.
3. **Register conversationally** via the OKX agent: provide name, description,
   service list, and default pricing. Choose a service mode (below) and submit
   for review.
4. **Review:** OKX reviews within ~24 hours. Result arrives by email and in the
   agent conversation window. Once approved, the ASP appears in the marketplace;
   before approval it is still reachable via its Agent ID.

## Service modes

### A2MCP (Agent-to-MCP) — pay-per-call API  ← recommended for the 3-day build
- Standardized API services: data queries, utilities, generators.
- Two compliant endpoint forms:
  - **Free endpoint** — returns the result directly.
  - **Paid endpoint** — must be **x402-compliant** (OKX Payment SDK recommended).
- No negotiation; caller pays per call. Gas-free payments via x402 protocol.

### A2A (Agent-to-Agent) — negotiated escrow
- Agents negotiate price, scope, and delivery terms.
- Payment held in escrow; provider paid only after the user signs off.
- Disputes can escalate to arbitration.
- More impressive, more moving parts — risky under the deadline.

## OnchainOS toolkit (integration options)

- **Skills/CLI:** `npx skills add okx/onchainos-skills` — pre-built skills.
- **MCP:** connect any MCP-compatible client (Claude Code, Codex, Hermes, etc.),
  zero coding required.
- **Open API:** REST + WebSocket, any language.
- AI Toolkit: 9 skills / 72 features — token check, trade & transfer, market
  monitor, risk detection, onchain broadcast.
- Trade module: DEX aggregation across 500+ exchanges; 60+ networks;
  <100ms avg response; no OKX account required.

## Submission checklist (all four required)

- [ ] ASP built, listed, **approved and live** on okx.ai (invalid otherwise)
- [ ] X post with **#OKXAI** — intro, use case, demo/walkthrough ≤ 90 seconds
- [ ] Google form before **Jul 17, 23:59 UTC** — ASP details + X post link
- [ ] Confirm the X post link in the form actually resolves
