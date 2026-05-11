# PalmOS Architecture Walkthrough

PalmOS is a control plane for autonomous agent payments. The agent can run outside PalmOS, but every paid action routes through PalmOS before money moves.

```text
External agent
  -> PalmOS SDK/API
  -> agent credential authentication
  -> service catalog lookup
  -> policy check
  -> approval gate when needed
  -> PUSD payment instruction validation
  -> PUSD settlement on Solana or local service-test receipt
  -> paid-call/audit record
  -> dashboard operator view
```

## Main Components

- `frontend/` - public landing page, docs page, judge gate, and private dashboard.
- `src/server/dashboardApi.ts` - dashboard API, SDK API, agent credentials, service registry, approval actions, readiness checks.
- `src/sdk/PalmosAgentClient.ts` - JavaScript client used by external agents.
- `src/app/requestPaidAction.ts` - creates a governed payment request and runs policy.
- `src/app/executePaidServiceCall.ts` - executes paid service calls after policy approval.
- `src/integrations/pusd/*` - PUSD amount parsing, payment instructions, readiness checks, client, transfer, verifier, and service-test server.
- `src/integrations/ows/*` - governed wallet layer for agent wallets and Solana signing.
- `src/integrations/xmtp/*` - operator approval and resolution notifications.
- `src/store/*` - file-backed registries for agents, credentials, services, paid calls, readiness reports, and alerts.
- `runtime/` - session kernel, policy resolution, approval, signing, simulation, reconciliation, and audit timeline.

## External Agent Flow

1. Operator creates an agent in the PalmOS dashboard.
2. Operator configures policy: budget, max per call, vendor allowlist, approval threshold, and wallet controls.
3. Operator issues an agent SDK credential from the agent detail page.
4. External agent stores `PALMOS_API_URL`, `PALMOS_AGENT_TOKEN`, `PALMOS_SERVICE_ID`, and request payload configuration.
5. External agent calls `POST /api/sdk/v1/pay`.
6. PalmOS authenticates the credential and resolves the agent.
7. PalmOS checks the requested service against the agent policy.
8. A small allowed payment executes automatically.
9. A higher-value payment becomes approval-pending.
10. A disallowed vendor/service is blocked.
11. The dashboard records the paid call, policy result, transaction signature/receipt, and audit timeline.

## Settlement Modes

PalmOS has three settlement modes for the MVP:

- `local-demo`: the same PUSD 402-style payment instruction interface is used, but the receipt is clearly labeled as local service-test.
- `ows`: PalmOS imports the funded Solana payer into OWS for the agent and OWS signs/broadcasts the PUSD transfer.
- `real-solana`: PalmOS signs and broadcasts a direct Solana PUSD transfer using the configured payer key.

The product UI distinguishes these modes so judges can see where real on-chain settlement begins and where local service testing is being used.

## Policy And Approval

Policy lives before settlement:

- Agent identity must be valid.
- Agent lifecycle state must allow spending.
- Service/vendor must be allowed.
- Amount must fit max-per-call and session budget constraints.
- Amounts above the auto-approval threshold pause for operator approval.
- Payment instructions returned by the service must match the approved policy before signing.

This means a service cannot change the recipient, mint, network, or amount after policy approval without PalmOS blocking the payment.

## Developer Surface

The current MVP surface is:

- Dashboard-issued agent credentials.
- SDK routes under `/api/sdk/v1/*`.
- `src/sdk/PalmosAgentClient.ts`.
- `packages/agent` as the publishable `@palmos/agent` package.
- `npm run palmos:external-agent` for a repo-local external agent demo.

The intended package target is:

```bash
npm install @palmos/agent
```

That package should wrap the same SDK API and make external-agent setup feel like installing a payment skill.

## MCP / Coding-Agent Direction

PalmOS can later expose an MCP server or coding-agent tool interface:

- `list_services`
- `request_paid_service`
- `check_policy`
- `get_agent_status`

That would let Claude Code, Codex, and similar agents request governed payments without holding an unrestricted wallet.

## Umbra Direction

Umbra is an MVP add-on track, not a replacement for the PUSD rail. The target shape is:

```text
agent -> PalmOS policy/approval -> Umbra private settlement -> PalmOS reconciliation/audit
```

PalmOS should remain the policy, approval, and audit operating system. Umbra should be integrated as a private settlement rail after the normal PalmOS/PUSD path remains stable.
