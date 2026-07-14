# Project Ideas (3-day A2MCP builds)

Common thread for all: **single stateless endpoint, structured JSON output,
priced per call via x402.** Reviewable in 24h, demo-able in 90 seconds.

## Lifestyle Companion (thin competition)

### Travel entry-requirements checker
`{origin, destination, passport, purpose} → {visa_required, docs, vaccines,
max_stay, sources}` — agents planning trips call it per leg.

### Subscription auditor
Transaction export (CSV/JSON) in → recurring charges detected, monthly total,
cancellation steps per merchant.

## Artistic Excellence (thin competition)

### Brand-kit generator
`{name, vibe, industry}` → logo variants + palette (hex) + typography spec as
structured JSON + asset URLs. Machine-readable output is what makes it
agent-native instead of "an image-gen wrapper."

## Software Utility

### Dependency-risk report
`package.json` / `requirements.txt` in → CVEs, license conflicts, abandonment
signals, upgrade paths out. Plays to existing strengths; strong 90s demo.

## Finance Copilot (avoid trading tools — crowded)

### Invoice/receipt normalizer
Image or PDF in → normalized structured data out (vendor, line items, tax,
currency, category). Boring, real, per-call monetizable.

## Selection criteria

- Can the core endpoint work end-to-end by end of Jul 15?
- Does the output make sense for another AGENT to consume (structured, verifiable)?
- Is there a believable per-call price (e.g. 0.05–0.25 USDT)?
- Can the 90-second demo show: agent calls ASP → pays → gets result?
