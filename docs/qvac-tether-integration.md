# PalmOS x QVAC/Tether Integration

PalmOS should stay the governed payment and audit layer. A QVAC/Tether project should live in its own repo and call PalmOS as external payment infrastructure.

## Demo Shape

```text
Private QVAC agent
  -> decides it needs paid data or settlement
  -> calls PalmOS with an agent token
  -> PalmOS checks policy, approval threshold, service allowlist, and budget
  -> PalmOS settles through the selected rail
  -> PalmOS records the transaction and audit trail
```

The private agent owns reasoning and private context. PalmOS owns payment authority.

## Strong Use Case

Build a local treasury or research agent that can inspect private instructions, decide which paid service it needs, and request payment through PalmOS.

Good demo prompt:

```text
Review my private market brief request, buy the approved data service if policy allows, and return the result with a payment receipt.
```

This makes QVAC meaningful because the reasoning can stay local/private, while PalmOS still enforces payment controls.

## PalmOS Contract

External projects should treat these as the stable integration points:

- `PALMOS_API_URL`
- `PALMOS_AGENT_TOKEN`
- `PALMOS_SERVICE_ID`
- `GET /api/sdk/v1/me`
- `GET /api/sdk/v1/services`
- `POST /api/sdk/v1/pay`

The preferred JavaScript client is the planned package:

```bash
npm install @palmos/agent
```

Until the package is published, external demos can use the repo command:

```bash
npm run palmos:external-agent -- --json
```

## Stablecoin Expansion

PalmOS is currently proven around PUSD on Solana. Tether/USDT should be added as an additional settlement asset, not as a replacement for the PUSD rail.

Target shape:

```text
SettlementAsset = PUSD | USDT
SettlementRail = local-demo | ows | real-solana | future-usdt
```

For the MVP, keep USDT in the architecture and integration story unless there is enough time to implement and test a real USDT transfer path end to end.

## Repo Boundary

PalmOS repo should contain:

- PalmOS SDK/API contract.
- Payment policy and settlement implementation.
- Audit and dashboard records.
- This integration guide.

QVAC/Tether repo should contain:

- The private/local agent runtime.
- QVAC setup instructions.
- A `PALMOS_INTEGRATION.md` file that points back to this document.
- Its own `.env.example` containing PalmOS credentials.

Do not duplicate PalmOS policy logic inside the QVAC project. The QVAC agent should ask PalmOS to pay; PalmOS decides whether it can.
