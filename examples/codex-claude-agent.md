# Codex / Claude Code Agent Pattern

PalmOS can be used as the payment control plane for coding agents and CLI agents.

The coding agent should not receive unrestricted wallet keys. It should receive a PalmOS agent credential and call PalmOS whenever it needs a paid service or governed payment.

## Mental Model

```text
Codex / Claude Code / external agent
  -> calls PalmOS SDK/API
  -> PalmOS authenticates the agent
  -> PalmOS checks policy
  -> PalmOS settles or requests approval
  -> dashboard records the audit trail
```

## Environment For A Coding Agent

Give the coding-agent process only these PalmOS variables:

```bash
PALMOS_API_URL=http://127.0.0.1:4030
PALMOS_AGENT_TOKEN=palmos_YOUR_AGENT_TOKEN
PALMOS_SERVICE_ID=local.pusd.spot_price
```

Do not give the coding agent:

```text
PUSD_AGENT_PRIVATE_KEY
PUSD_AGENT_KEYPAIR_PATH
OWS secrets
XMTP sender keys
```

Those stay on the PalmOS backend.

## CLI Tool Shape

The simplest tool a coding agent can call today is:

```bash
npm run palmos:external-agent -- --json
```

The JSON output tells the coding agent whether the request was:

- `executed`
- `approval_pending`
- `blocked`
- `execution_failed`

## Example Agent Instruction

Use this as a system or project instruction for a coding agent:

```text
When a task requires a paid API call or service payment, do not use wallet keys directly.
Use PalmOS by running:

npm run palmos:external-agent -- --json

Read the JSON outcome:
- If outcome.kind is "executed", continue with the paid result.
- If outcome.kind is "approval_pending", tell the operator to approve it in PalmOS.
- If outcome.kind is "blocked", explain the policy reason and stop.
- If the command fails, report the error without retrying unsafe payments.
```

## Future MCP Tool Surface

The MCP version should expose narrow tools:

- `palmos_list_services`
- `palmos_request_paid_service`
- `palmos_get_agent_status`
- `palmos_get_payment_result`

The MCP server should still call the same PalmOS SDK/API. MCP is only a tool wrapper, not a separate payment authority.

## Demo Script

1. Open a terminal outside the dashboard.
2. Export `PALMOS_API_URL`, `PALMOS_AGENT_TOKEN`, and `PALMOS_SERVICE_ID`.
3. Ask the coding agent to request a paid market-data service.
4. The coding agent runs PalmOS.
5. PalmOS returns `executed`, `approval_pending`, or `blocked`.
6. Open the dashboard and show the transaction or approval record.
