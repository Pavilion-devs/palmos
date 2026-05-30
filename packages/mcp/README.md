# @getpalmos/mcp

Model Context Protocol (MCP) server for PalmOS. It gives Claude Code, Codex, and
any other MCP-capable agent a set of **governed payment tools** — the agent can
discover paid services, check policy, and request payments, while PalmOS enforces
budget, allowlist, approval, settlement, and audit rules server-side. The agent
never holds a wallet key.

## Tools

| Tool | Purpose |
| --- | --- |
| `palmos_list_services` | List the paid services this agent is allowed to call. |
| `palmos_check_policy` | Preview whether a payment would be allowed / approval-gated / denied (no spend). |
| `palmos_get_agent_status` | Report the agent's PalmOS identity, trust tier, and settlement mode. |
| `palmos_pay` | Execute a governed paid-service call. |

`palmos_pay` is the only tool that can move money, and every call is still
gated by PalmOS policy: small allowed payments execute, higher-value ones become
approval-pending for an operator, and disallowed services are blocked.

## Prerequisites

1. A running PalmOS backend (defaults to the hosted API `https://api.getpalmos.xyz`).
2. An agent created in the PalmOS dashboard with an issued SDK credential
   (`palmos_...` token).

## Configure

The server reads two environment variables:

- `PALMOS_AGENT_TOKEN` (required) — the issued `palmos_...` SDK credential.
- `PALMOS_API_URL` (optional) — defaults to the hosted API; set it only for a
  self-hosted backend.

### Claude Code

```bash
claude mcp add palmos --env PALMOS_AGENT_TOKEN=palmos_YOUR_TOKEN -- npx -y @getpalmos/mcp
```

or add it to `.mcp.json` / your Claude Code MCP config directly:

```json
{
  "mcpServers": {
    "palmos": {
      "command": "npx",
      "args": ["-y", "@getpalmos/mcp"],
      "env": {
        "PALMOS_AGENT_TOKEN": "palmos_YOUR_TOKEN"
      }
    }
  }
}
```

### Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.palmos]
command = "npx"
args = ["-y", "@getpalmos/mcp"]
env = { PALMOS_AGENT_TOKEN = "palmos_YOUR_TOKEN" }
```

### Local (before publishing / for development)

Point the runner at the built file in this repo instead of `npx`:

```json
{
  "mcpServers": {
    "palmos": {
      "command": "node",
      "args": ["/absolute/path/to/palmos/packages/mcp/dist/index.js"],
      "env": { "PALMOS_AGENT_TOKEN": "palmos_YOUR_TOKEN" }
    }
  }
}
```

Build it first with `npm run build` (from `packages/mcp`) or
`npm run package:mcp:build` from the repo root.

## Use

Once configured, ask the agent naturally, e.g.:

> "List my PalmOS services, check the policy for `local.pusd.spot_price`, then
> pay for a BTC/USD spot price."

The agent will call `palmos_list_services` → `palmos_check_policy` → `palmos_pay`.
PalmOS records every outcome (executed, approval-pending, blocked) with an audit
trail in the dashboard.

## Token storage

Treat `PALMOS_AGENT_TOKEN` like a payment credential: keep it in your MCP client's
secret/env config, not in source control, use a separate credential per runtime,
and rotate or revoke it from the PalmOS dashboard if it may have been exposed.
