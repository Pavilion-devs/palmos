# PalmOS Screenshot Capture Plan

Use this local app while the dev servers are running:

- Frontend: `http://127.0.0.1:5173/`
- Backend: `http://127.0.0.1:4030`

The local screenshot workspace is already populated with:

- 3 agents
- 1 executed PUSD service-test payment
- 1 pending approval
- 1 blocked policy decision
- OWS-backed agent wallet metadata
- Services, transactions, approvals, and audit records

## Capture Order

1. Landing page
   - URL: `http://127.0.0.1:5173/`
   - Use for: video intro, brand/product opening.

2. Dashboard home
   - URL: `http://127.0.0.1:5173/#dashboard`
   - Use for: control-plane overview.

3. My Agents
   - URL: `http://127.0.0.1:5173/#dashboard/agents`
   - Use for: showing multiple governed agents.

4. Research Agent detail
   - URL: `http://127.0.0.1:5173/#dashboard/agents/research_agent`
   - Use for: showing an active agent, wallet, policy, and spend controls.

5. Ops Buyer detail
   - URL: `http://127.0.0.1:5173/#dashboard/agents/ops_buyer`
   - Use for: showing an agent with pending approval.

6. Services
   - URL: `http://127.0.0.1:5173/#dashboard/services`
   - Use for: showing APIs/services agents can pay for.

7. Spot Price service detail
   - URL: `http://127.0.0.1:5173/#dashboard/services/local.pusd.spot_price`
   - Use for: showing vendor, price, rail, and allowlist context.

8. Transactions
   - URL: `http://127.0.0.1:5173/#dashboard/transactions`
   - Use for: showing audit trail and settlement states.

9. Transaction detail
   - URL: open the first transaction from the Transactions page.
   - Use for: showing payment details, policy result, and local-vs-real settlement clarity.

10. Approvals
    - URL: `http://127.0.0.1:5173/#dashboard/approvals`
    - Use for: showing approval queue and operator controls.

11. Settings / SDK
    - URL: `http://127.0.0.1:5173/#dashboard/settings`
    - Use for: showing PalmOS as developer infrastructure, not just a dashboard.

## Recommended Capture Format

- Take screenshots at 16:9, ideally 1920x1080 or higher.
- Also record one 30-60 second browser walkthrough.
- For the walkthrough, move slowly:
  `Landing -> Dashboard -> Agents -> Services -> Transactions -> Approvals`.
- Do not include secrets, private keys, or full API tokens in any capture.
- If a page has sensitive-looking IDs, crop to the UI section the designer needs.

## Best Shots For The Motion Designer

- Hero/landing page for intro.
- Dashboard home for the “control plane” moment.
- Agent detail for “governed wallet”.
- Services page for “agents buy APIs and services”.
- Approvals page for “approval if needed”.
- Transactions detail for “audit trail”.
