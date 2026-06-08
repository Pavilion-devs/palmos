Execute a governed PalmOS PUSD payment and report the result clearly.

Arguments: $ARGUMENTS

## What to do

1. Check that `PALMOS_AGENT_TOKEN` is available in the environment. If it is not set, tell the user to run `npm run palmos:init` first to create an agent and get a token.

2. Parse the arguments to identify the service and optional request payload:
   - If the argument looks like a service ID (e.g. `palmos.launch.audit`, `palmos.research.defi_risk`), use `--service <id>`
   - If JSON is present (e.g. `{"base":"BTC","quote":"USD"}`), use `--request-json '<json>'`
   - If no arguments are given, use the default service from `PALMOS_SERVICE_ID` or `palmos.launch.audit`

3. Run the external agent command:
   ```bash
   npm run palmos:external-agent -- --json [--service <serviceId>] [--request-json '<json>']
   ```

4. Parse the JSON output and report:
   - `outcome.kind === "executed"` → Payment went through. Show the amount, the execution ID, the dashboard link `#dashboard/transactions/<id>`, and if `outcome.transactionExplorerUrl` exists, render it as a Markdown link. Use `[Open in Solscan](<url>)` for public PUSD links and `[Open private settlement](<url>)` for Umbra/private links.
   - If the agent privacy mode is `required`, this command should still be used. PalmOS will route through the Umbra private settlement path and fulfill the paid service with a private settlement proof header. Do not tell the user to run `/palmos-private-pay` unless this primary command fails.
   - `outcome.kind === "approval_pending"` → PalmOS is waiting for operator approval. Tell the user to visit `#dashboard/approvals`
   - `outcome.kind === "blocked"` → Policy blocked the payment. Show `outcome.reason`
   - Command fails entirely → Check that `PALMOS_AGENT_TOKEN` is set and the backend is running on `PALMOS_API_URL` (default `http://127.0.0.1:4030`)

## Available services

| Service ID | Description | Amount | Behavior |
|---|---|---|---|
| `palmos.launch.audit` | Production Launch Audit API | 0.02 PUSD | Auto-approved at default threshold; best default demo |
| `palmos.intel.onchain_flow` | On-Chain Flow Intelligence | 0.02 PUSD | Auto-approved at default threshold |
| `palmos.research.defi_risk` | DeFi Protocol Risk Report | 0.25 PUSD | Triggers approval flow above 0.05 PUSD |
| `palmos.ops.vendor_brief` | Vendor Ops Brief | 0.10 PUSD | Triggers approval flow above 0.05 PUSD |

If no service is specified in the arguments, default to `palmos.launch.audit`.

## Example outputs to expect

Auto-approved (with service data returned):
```
Outcome: AUTO-APPROVED / EXECUTED
Amount: 0.02 PUSD
Execution: paid_call_...
Explorer: [Open in Solscan](https://solscan.io/tx/...)

Service response:
  Launch Audit: PASS WITH WARNINGS
  Target: https://www.getpalmos.xyz
  Score: 87/100
  Recommendation: Proceed with submission, keep monitoring active, and fix CSP/alerting after the demo.
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
- If you want to demo the approval flow, use `palmos.research.defi_risk` which costs 0.25 PUSD and exceeds the default 0.05 PUSD auto-approve threshold
