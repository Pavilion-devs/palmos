Execute a governed PalmOS PUSD payment and report the result clearly.

Arguments: $ARGUMENTS

## What to do

1. Check that `PALMOS_AGENT_TOKEN` is available in the environment. If it is not set, tell the user to run `npm run palmos:init` first to create an agent and get a token.

2. Parse the arguments to identify the service and optional request payload:
   - If the argument looks like a service ID (e.g. `local.pusd.spot_price`, `local.pusd.ops_brief`), use `--service <id>`
   - If JSON is present (e.g. `{"base":"BTC","quote":"USD"}`), use `--request-json '<json>'`
   - If no arguments are given, use the default service from `PALMOS_SERVICE_ID` or `local.pusd.spot_price`

3. Run the external agent command:
   ```bash
   npm run palmos:external-agent -- --json [--service <serviceId>] [--request-json '<json>']
   ```

4. Parse the JSON output and report:
   - `outcome.kind === "executed"` → Payment went through. Show the amount, the execution ID, and link to `#dashboard/transactions/<id>`
   - `outcome.kind === "approval_pending"` → PalmOS is waiting for operator approval. Tell the user to visit `#dashboard/approvals`
   - `outcome.kind === "blocked"` → Policy blocked the payment. Show `outcome.reason`
   - Command fails entirely → Check that `PALMOS_AGENT_TOKEN` is set and the backend is running on `PALMOS_API_URL` (default `http://127.0.0.1:4030`)

## Available services

| Service ID | Description | Amount | Behavior |
|---|---|---|---|
| `palmos.intel.onchain_flow` | On-Chain Flow Intelligence | 0.02 PUSD | Auto-approved at default threshold |
| `palmos.research.defi_risk` | DeFi Protocol Risk Report | 0.25 PUSD | Triggers approval flow above 0.05 PUSD |

If no service is specified in the arguments, default to `palmos.intel.onchain_flow`.

## Example outputs to expect

Auto-approved (with service data returned):
```
Outcome: AUTO-APPROVED / EXECUTED
Amount: 0.02 PUSD
Execution: paid_call_...

Service response:
  {
    "asset": "SOL",
    "price": "150.00",
    "onchainFlow": { "net24h": "+$31.5M", "whaleWallets": 21, "bias": "strong accumulation" },
    "provider": "palmos.intel"
  }
```

Approval pending:
```
Outcome: PENDING OPERATOR APPROVAL
Dashboard: #dashboard/approvals
```

Policy block:
```
Outcome: POLICY BLOCK
Reason: No allowed vendor or destination was resolved for the paid action.
```

## Notes

- The agent must be running (`npm run dashboard:api`) for this to work
- All outcomes — executed, pending, blocked — appear in the PalmOS dashboard at `#dashboard/transactions`
- If you want to demo the approval flow, use `local.pusd.ops_brief` which costs 0.25 PUSD and exceeds the default 0.05 PUSD auto-approve threshold
