# @palmos/agent

PalmOS SDK client for external agents that need governed PUSD payments.

PalmOS lets an agent run outside the PalmOS dashboard while routing paid actions through policy, approvals, PUSD settlement, and audit records.

## Install

```bash
npm install @palmos/agent
```

## Configure

Create an agent in the PalmOS dashboard, then issue an SDK credential from that agent's detail page.

```bash
PALMOS_API_URL=https://your-palmos-backend.example
PALMOS_AGENT_TOKEN=palmos_YOUR_AGENT_TOKEN
PALMOS_SERVICE_ID=local.pusd.spot_price
```

## Use

```ts
import { PalmosAgentClient } from '@palmos/agent'

const palmos = PalmosAgentClient.fromEnv()

const services = await palmos.listServices()
console.log(services)

const result = await palmos.pay({
  serviceId: process.env.PALMOS_SERVICE_ID ?? 'local.pusd.spot_price',
  request: {
    base: 'BTC',
    quote: 'USD',
  },
})

console.log(result)
```

## What PalmOS Enforces

- Agent credential identity.
- Agent lifecycle state.
- Session budget and max-per-call rules.
- Vendor and service allowlists.
- Approval gates for higher-value payments.
- PUSD payment instruction binding before settlement.
- Paid-call and audit records for every outcome.

## MVP Note

This package wraps the PalmOS SDK API. The backend must be running and the agent credential must be issued from the PalmOS dashboard.
