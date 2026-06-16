# @getpalmos/agent

PalmOS SDK client + CLI for external agents. PalmOS lets an agent run outside the dashboard while
routing every on-chain action through policy, approvals, vault custody, and an on-chain audit trail.

## Connect an agent (CLI)

Create an agent in the [PalmOS dashboard](https://getpalmos.xyz), then bring it online from a terminal —
no install needed:

```bash
npx @getpalmos/agent connect
```

It prompts for your agent token, authenticates it (which connects it on the dashboard), and lists the
governed tools it can use. The agent holds no keys — every action runs through PalmOS.

> Env: `PALMOS_AGENT_TOKEN` (skip the prompt) · `PALMOS_API_URL` (point at a self-hosted backend).

## Install (SDK)

```bash
npm install @getpalmos/agent
```

## Configure

Create an agent in the PalmOS dashboard, then issue an SDK credential from that agent's detail page.

```bash
PALMOS_AGENT_TOKEN=palmos_YOUR_AGENT_TOKEN
PALMOS_SERVICE_ID=local.pusd.spot_price
# Optional. Defaults to the hosted PalmOS API (https://api.getpalmos.xyz).
# Set this only when pointing at a self-hosted backend.
PALMOS_API_URL=https://your-palmos-backend.example
```

## Use

```ts
import { PalmosAgentClient } from '@getpalmos/agent'

const palmos = PalmosAgentClient.fromEnv()

const services = await palmos.listServices()
console.log(services)

const policy = await palmos.checkPolicy({
  serviceId: process.env.PALMOS_SERVICE_ID ?? 'local.pusd.spot_price',
})
console.log(policy)

const result = await palmos.pay({
  serviceId: process.env.PALMOS_SERVICE_ID ?? 'local.pusd.spot_price',
  idempotencyKey: 'agent-run-2026-05-09T12-00-00Z-btc-spot',
  privacy: 'default',
  request: {
    base: 'BTC',
    quote: 'USD',
  },
})

console.log(result)

switch (result.result.kind) {
  case 'executed':
    console.log('Paid call executed:', result.result.execution.executionId)
    break
  case 'approval_pending':
    console.log('Approval required:', result.result.execution.executionId)
    break
  case 'blocked':
    console.log('Policy blocked the call:', result.result.reason)
    break
  case 'execution_failed':
    console.log('Execution failed:', result.result.error)
    break
}
```

## What PalmOS Enforces

- Agent credential identity.
- Agent lifecycle state.
- Session budget and max-per-call rules.
- Vendor and service allowlists.
- Approval gates for higher-value payments.
- PUSD payment instruction binding before settlement.
- Idempotent SDK payment retries when `idempotencyKey` is provided.
- Paid-call and audit records for every outcome.

## Tool Interface

Agent runtimes that prefer named tools can use the SDK helpers:

```ts
const tools = await palmos.listTools()
const status = await palmos.getAgentStatus()
const policy = await palmos.checkPolicy({ serviceId: 'local.pusd.spot_price' })
const payment = await palmos.requestPaidService({
  serviceId: 'local.pusd.spot_price',
  idempotencyKey: 'agent-run-123',
  request: { base: 'BTC', quote: 'USD' },
})
```

These map to `list_services`, `get_agent_status`, `check_policy`, and `request_paid_service` on the PalmOS SDK API.

## Privacy Mode

Operators can configure an agent for private settlement with `privacyMode`:

- `disabled`: normal governed settlement only.
- `allowed`: private settlement may be requested when the service/runtime supports it.
- `required`: public settlement is blocked unless a private route is available.

SDK payment requests may pass `privacy: 'required'` to request private settlement. PalmOS will fail closed if a private route is not configured for that request.

## Examples

The package includes runnable examples:

```bash
node examples/plain-node-agent.mjs
node examples/claude-code-agent.mjs
node examples/codex-agent.mjs
node examples/research-worker.mjs
```

Use `PALMOS_IDEMPOTENCY_KEY` for deterministic retries in scripts where a job id already exists. Otherwise derive idempotency keys from stable agent job/run ids, not from random values.

## Token Storage

- Treat `PALMOS_AGENT_TOKEN` like a payment credential.
- Store it in the agent runtime secret store or environment manager, not in source code.
- Do not print the full token in logs; show only the key prefix if needed.
- Use a separate PalmOS credential per deployed agent/runtime.
- Rotate the credential from the dashboard if a runtime, log sink, or CI job may have exposed it.
- Revoke credentials that are no longer used.

## MVP Note

This package wraps the PalmOS SDK API. The backend must be running and the agent credential must be issued from the PalmOS dashboard.
