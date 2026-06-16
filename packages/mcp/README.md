# @getpalmos/mcp

Model Context Protocol (MCP) server for PalmOS. It gives Claude Code, Codex, and any other
MCP-capable agent PalmOS's **governed agent-wallet tools** — Byreal swaps, concentrated (CLMM)
liquidity, pool and position discovery, wallet context, and policy checks — while PalmOS enforces
policy, custody, settlement, and an on-chain audit trail server-side. The agent never holds a key.

The bridge is generic: it exposes whatever governed tools your PalmOS backend offers (read live from
`/api/sdk/v1/tools`), so new skills appear automatically without upgrading this package.

## Tools

Exact tools depend on your backend (the server lists them on connect). A typical Byreal-enabled
PalmOS backend exposes:

| Tool | Purpose |
| --- | --- |
| `get_wallet_context` | The agent's balances, portfolio, and the policy controls it must act within. |
| `list_byreal_pools` | Discover Byreal CLMM pools — ids, token mints, live price, and which are policy-allowed. |
| `get_byreal_quote` | A live Byreal swap quote (read-only). |
| `request_asset_swap` | A governed Byreal swap (policy-checked, vault-signed, settled). |
| `list_byreal_positions` | The agent's CLMM liquidity positions. |
| `request_liquidity_action` | Governed CLMM liquidity: open / increase / decrease / close. Pass `rangePercent` for an automatic ± range. |
| `check_policy` | Preview whether an action is allowed / approval-gated / denied (no spend). |
| `get_agent_status` | The agent's PalmOS identity, trust tier, and settlement mode. |

Every governed action is gated by PalmOS policy: within the auto-approve threshold it settles, a
larger-but-allowed action becomes approval-pending for an operator, and an off-policy action is
blocked. The agent reads the governed outcome and reasons about it.

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

> "Show me the SOL/USDC Byreal pools I'm allowed to use, then open a 0.05 USDC liquidity
> position with a ±12% range."

The agent calls `list_byreal_pools` → `request_liquidity_action`. PalmOS checks the policy, the OWS
vault signs, the position settles on Byreal, and the decision is logged on-chain — every outcome
(executed, approval-pending, blocked) shows up in the dashboard with an audit trail.

## Token storage

Treat `PALMOS_AGENT_TOKEN` like a payment credential: keep it in your MCP client's
secret/env config, not in source control, use a separate credential per runtime,
and rotate or revoke it from the PalmOS dashboard if it may have been exposed.
