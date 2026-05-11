# External Agent Demo

This demo proves that PalmOS is infrastructure for agents running outside the dashboard.

The external agent does not hold an unrestricted wallet. It holds a PalmOS agent credential and asks PalmOS to execute paid actions. PalmOS enforces policy, approval, PUSD payment, and audit.

## 1. Start PalmOS Locally

Backend:

```bash
npm run dashboard:api
```

Frontend:

```bash
cd frontend
npm run dev
```

Open:

```text
http://127.0.0.1:5173/#dashboard
```

## 2. Create Or Select An Agent

In the dashboard:

1. Open `My Agents`.
2. Create or select an agent.
3. Confirm the agent has at least one allowed service.
4. Open the agent detail page.
5. Create an SDK credential.
6. Copy the token immediately. PalmOS stores only its hash.

## 3. Configure The External Agent

```bash
export PALMOS_API_URL=http://127.0.0.1:4030
export PALMOS_AGENT_TOKEN=palmos_YOUR_AGENT_TOKEN
export PALMOS_SERVICE_ID=local.pusd.spot_price
export PALMOS_AGENT_REQUEST_JSON='{"base":"BTC","quote":"USD"}'
```

## 4. Run An Auto-Approved Payment

```bash
npm run palmos:external-agent
```

Expected terminal shape:

```text
PalmOS external agent run
-------------------------
API: http://127.0.0.1:4030
Agent: Market Monitor Agent (market_monitor_agent)
Service: PUSD Market Data API (local.pusd.spot_price)
Policy listed service as: allowed
Request: {"base":"BTC","quote":"USD"}

Outcome: AUTO-APPROVED / EXECUTED
Amount: 0.01 PUSD
Execution: paid_call_...
Dashboard: #dashboard/transactions/paid_call_...
```

Then open the dashboard transactions page:

```text
http://127.0.0.1:5173/#dashboard/transactions
```

## 5. Run An Approval-Required Payment

Use a service/amount above the agent's auto-approval threshold:

```bash
PALMOS_SERVICE_ID=local.pusd.ops_brief \
PALMOS_AGENT_REQUEST_JSON='{"symbols":["BTC","ETH","SOL"],"focus":"ops market pulse"}' \
npm run palmos:external-agent
```

Expected result:

```text
Outcome: PENDING OPERATOR APPROVAL
Dashboard: #dashboard/approvals
```

Approve or reject it from:

```text
http://127.0.0.1:5173/#dashboard/approvals
```

## 6. Run A Policy Block

Use a service that exists but is not allowed for the selected agent:

```bash
PALMOS_SERVICE_ID=local.pusd.ops_brief \
PALMOS_AGENT_REQUEST_JSON='{"symbols":["BTC","ETH"],"focus":"blocked vendor test"}' \
npm run palmos:external-agent
```

Expected result:

```text
Outcome: POLICY BLOCK
Reason: No allowed vendor or destination was resolved for the paid action.
```

The dashboard will still record the blocked attempt.

## JSON Mode

For programmatic agents:

```bash
npm run palmos:external-agent -- --json
```

This prints a stable JSON summary with `agent`, `service`, `request`, and `outcome`.
