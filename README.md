# PalmOS

> Give AI agents PUSD wallets, not blank checks.

PalmOS adapts the SpendOS agent-governance runtime for Palm USD. It is a Solana-native agent payment operating system where autonomous workers can pay APIs and services in PUSD while operators keep policy control, approval gates, XMTP alerts, and an audit trail.

## What It Does

PalmOS provisions agents with governed wallets, budgets, chain restrictions, vendor allowlists, and spend thresholds. When an agent tries to buy a paid service:

- **Small PUSD spend** auto-executes under policy and is recorded.
- **High-value PUSD spend** pauses and requests operator approval over XMTP.
- **Blocked vendor** is denied immediately and recorded.
- **Stale agent** loses spend authority through the existing dead-man's-switch flow.

The dashboard shows agent balances, policy decisions, approval queue, paid-call history, and transaction/audit records.

## External Agent Demo

The strongest PalmOS flow starts outside the dashboard:

1. Register an external agent in PalmOS.
2. Configure its budget, max spend, vendor allowlist, and approval threshold.
3. Issue an SDK credential from the agent detail page.
4. Run an external agent with that credential.
5. Watch PalmOS decide whether the payment is auto-approved, approval-pending, or blocked.

Target package:

```bash
npm install @palmos/agent
```

The package skeleton lives in `packages/agent` and wraps the PalmOS SDK API. Until it is published, the repo-local MVP path is:

```bash
PALMOS_API_URL=http://127.0.0.1:4030 \
PALMOS_AGENT_TOKEN=palmos_... \
PALMOS_SERVICE_ID=local.pusd.spot_price \
PALMOS_AGENT_REQUEST_JSON='{"base":"SOL","quote":"USD"}' \
npm run palmos:external-agent
```

See [architecture.md](./architecture.md) for the full external-agent architecture walkthrough.

Demo references:

- [examples/external-agent-demo.md](./examples/external-agent-demo.md)
- [examples/codex-claude-agent.md](./examples/codex-claude-agent.md)
- [docs/umbra-private-workflow.md](./docs/umbra-private-workflow.md)
- [docs/qvac-tether-integration.md](./docs/qvac-tether-integration.md)

Submission references:

- [docs/deployment.md](./docs/deployment.md)
- [docs/submission-readiness.md](./docs/submission-readiness.md)
- [docs/security-notes.md](./docs/security-notes.md)
- [docs/xmtp-runtime.md](./docs/xmtp-runtime.md)
- [docs/package-publishing.md](./docs/package-publishing.md)
- [docs/workspace-curation.md](./docs/workspace-curation.md)
- [real-pusd-proof.md](./real-pusd-proof.md)

## Current Build Status

This repo is in active migration from SpendOS:

- Existing runtime, policy engine, OWS integration, XMTP alerts, and dashboard are retained.
- Primary payment rail is now PalmOS/PUSD on Solana; legacy x402 modules are retained only as isolated compatibility code.
- Product name is now PalmOS.
- Official PUSD mainnet Solana mint is configured in code.

Official PUSD Solana mint:

```text
CZzgUBvxaMLwMhVSLgqJn3npmxoTo6nzMNQPAnwtHF3s
```

PUSD decimals:

```text
6
```

Fresh mainnet proof:

- OWS-settled agent payment: `https://solscan.io/tx/6fBfavJEvN4oYbH9kuGLHkCiZsL6vga4U1aJHK3a9VoSiiC33Nhw9xKB9drPBkt824wubY492nPTpozSnWH8iB9`
- Direct real-solana agent payment: `https://solscan.io/tx/2xzkxPi5246gnMSaTH3wqkpEWd1CQF3PsLcBNP2dB7HbzXS1wT3ZBpCL2PFWazTJxieuUfrqFHjTihneV3XtwUnp`

## Development

Prerequisites:

- Node 22+
- Bun for existing CLI scripts

Install dependencies:

```bash
npm install
```

Run the backend typecheck:

```bash
npm run check
```

Start the dashboard API:

```bash
npm run dashboard:api
```

Start only the local PUSD-protected demo API:

```bash
npm run pusd:server
```

Run the PalmOS backend worker once:

```bash
npm run palmos:worker
```

The worker seeds governed demo agents if needed, chooses a paid PUSD service call, runs the normal policy gate, pays the PUSD-protected API, and writes the paid-call/audit records. Set `AGENT_TASK` to override the default market-data task.

Run an external agent process through the PalmOS SDK API:

```bash
PALMOS_API_URL=http://127.0.0.1:4030 \
PALMOS_AGENT_TOKEN=palmos_... \
PALMOS_SERVICE_ID=local.pusd.spot_price \
PALMOS_AGENT_REQUEST_JSON='{"base":"SOL","quote":"USD"}' \
npm run palmos:external-agent
```

This calls the authenticated SDK routes and executes a policy-governed PUSD paid service call for the token's agent. See [sdk.md](./sdk.md) for the API contract and JavaScript client example.

Run an explicit Umbra private settlement proof for a registered dashboard agent:

```bash
UMBRA_SECRET_KEY_BASE64=... \
npm run palmos:private -- --agent <agent-id> --require-existing-agent --amount 0.001 --token wSOL
```

This attaches the minimum Umbra proof policy to the existing agent identity and records the private settlement proof in the dashboard. It does not replace the normal PUSD payment rail. See [docs/umbra-private-workflow.md](./docs/umbra-private-workflow.md) for the full private workflow.

If the private amount exceeds the agent's auto-approve threshold, PalmOS records it as approval-pending first:

```bash
npm run approval:pending -- approve <execution-id> --base-dir <workspace-dir>
```

Only after approval does the Umbra mixer/UTXO settlement execute and reconcile.

Agent settlement mode is selected at onboarding and persisted with the agent:

- `local-demo` uses the local PUSD service-test receipt path.
- `ows` imports `OWS_WALLET_PRIVATE_KEY` into an OWS Solana wallet and broadcasts the PUSD transfer through OWS signing.
- `real-solana` requires `PUSD_AGENT_KEYPAIR_PATH`, `PUSD_AGENT_PRIVATE_KEY`, or the same funded `OWS_WALLET_PRIVATE_KEY` fallback and broadcasts a direct Solana PUSD transfer.

Real modes do not silently fall back to local service-test settlement. If the selected rail is not configured, the paid call fails with a dashboard-visible error.

Check real PUSD settlement readiness:

```bash
npm run palmos:readiness -- --base-dir /tmp/palmos-live --wallet market_monitor_agent --recipient <merchant-wallet> --amount 0.01
```

This verifies the OWS Solana payer, merchant wallet, SOL fee balance, PUSD associated token account, and PUSD balance before using an `ows` settlement-mode agent. The readiness CLI loads `.env` and can derive the payer from `PUSD_AGENT_PRIVATE_KEY`, `PUSD_AGENT_KEYPAIR_PATH`, or `OWS_WALLET_PRIVATE_KEY`.

Dashboard API worker/readiness routes:

- `POST /api/dashboard/worker/run`
- `GET /api/dashboard/worker/status`
- `GET /api/dashboard/pusd/readiness`

Agent SDK routes:

- `GET /api/sdk/v1/me`
- `GET /api/sdk/v1/services`
- `POST /api/sdk/v1/pay`

Dashboard credential routes:

- `GET /api/dashboard/agents/:agentId/credentials`
- `POST /api/dashboard/agents/:agentId/credentials`
- `POST /api/dashboard/agent-credentials/:credentialId/revoke`

Dashboard service routes:

- `GET /api/dashboard/services`
- `POST /api/dashboard/services`
- `POST /api/dashboard/agents/:agentId/services/:serviceId/allow`

Start the frontend:

```bash
cd frontend
npm install
npm run dev
```

## Environment

Copy the example:

```bash
cp .env.example .env
```

Generate a Solana agent wallet for real PUSD settlement:

```bash
npm run palmos:wallet
```

Required for agent/worker flows:

- `OPENAI_API_KEY`
- `PUSD_SOLANA_RPC_URL`
- `PUSD_AGENT_WALLET`
- `PUSD_MERCHANT_WALLET`
- `PUSD_AGENT_KEYPAIR_PATH` or `PUSD_AGENT_PRIVATE_KEY` for real PUSD transfers

Optional:

- `XMTP_*` for approval alerts
- `OWS_*` for wallet-governance configuration
- `PALMOS_USE_OWS_SOLANA_PAYMENTS=1` remains supported as a backward-compatible default for older OWS agents without a persisted settlement mode
- `ZERION_API_KEY` for wallet enrichment where supported

## Architecture

Core retained from SpendOS:

- `runtime/` - session kernel, intents, policy resolution, approvals, signing, simulation, reconciliation.
- `src/policies/compileAgentPolicy.ts` - agent spend-policy model and decision logic.
- `src/app/requestPaidAction.ts` - policy-gated paid action request flow.
- `src/app/executePaidServiceCall.ts` - paid-service execution lifecycle.
- `src/store/PaidCallRegistry.ts` - paid-call persistence.
- `src/server/dashboardApi.ts` - backend dashboard API.
- `src/integrations/ows/` - OWS integration.
- `src/integrations/xmtp/` - XMTP approval alerts.
- `frontend/` - dashboard UI.

PalmOS/PUSD modules:

- `src/integrations/pusd/constants.ts`
- `src/integrations/pusd/amount.ts`
- `src/integrations/pusd/paymentInstructions.ts`
- `src/integrations/pusd/serviceCatalog.ts`
- `src/integrations/pusd/client.ts`
- `src/integrations/pusd/demoServer.ts`
- `src/integrations/pusd/keypair.ts`
- `src/integrations/pusd/transfer.ts`
- `src/integrations/pusd/verifier.ts`
- `src/sdk/PalmosAgentClient.ts`
- `src/store/PalmosServiceRegistry.ts`

OWS remains the governed wallet layer for demo agents. Service-test demos use PalmOS demo settlement by default; set `PALMOS_USE_OWS_SOLANA_PAYMENTS=1` only when the OWS Solana wallet has SOL for fees and PUSD for settlement.

Next modules to add:

- Dashboard endpoint to start or observe a worker run.

## Track Fit

PalmOS is built for the Palm USD x Superteam UAE Frontier track. It makes PUSD the settlement asset for autonomous API commerce on Solana while preserving institutional-grade controls around agents and spend authority.
