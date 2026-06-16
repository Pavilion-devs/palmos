#!/usr/bin/env node
/**
 * @getpalmos/mcp — a Model Context Protocol server that exposes PalmOS's governed agent tools to any
 * MCP client (Claude Code, Codex, …). It reads the live tool catalog from your PalmOS backend
 * (`GET /api/sdk/v1/tools`) and proxies each call to `POST /api/sdk/v1/tools/:toolName` with your
 * agent's bearer token — so every governed skill is available: Byreal swaps, CLMM liquidity
 * (open/increase/decrease/close), pool + position discovery, wallet context, policy checks, and
 * paid-service calls. New backend tools appear automatically; nothing here is hardcoded.
 *
 * The agent reaches PalmOS *only* through this bridge; PalmOS governs every call (policy gate, OWS
 * vault custody, on-chain decision log). The bridge holds no keys and cannot bypass policy — a denied
 * action comes back as an error the agent reads and reasons about.
 *
 * Run:
 *   npx @getpalmos/mcp
 *
 * Or wire it into an MCP client (e.g. Claude Code .mcp.json):
 *   {
 *     "command": "npx",
 *     "args": ["-y", "@getpalmos/mcp"],
 *     "env": { "PALMOS_AGENT_TOKEN": "palmos_...", "PALMOS_API_URL": "https://api.getpalmos.xyz" }
 *   }
 *
 * Env (also auto-loaded from a local .env):
 *   PALMOS_AGENT_TOKEN  (required) — an issued palmos_... agent credential from the dashboard.
 *   PALMOS_API_URL      (optional) — your PalmOS backend; default https://api.getpalmos.xyz.
 *   PALMOS_MCP_TOOLS    (optional) — comma-separated allowlist of tool names to expose.
 *
 * NOTE: stdout is the MCP JSON-RPC channel — all logging goes to stderr.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

// Pick up a local .env (PALMOS_AGENT_TOKEN, PALMOS_API_URL) when launched by an MCP client.
try {
  ;(process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.()
} catch {
  // no .env — rely on the ambient environment
}

const DEFAULT_API = 'https://api.getpalmos.xyz'
const API = (process.env.PALMOS_API_URL ?? DEFAULT_API).replace(/\/$/, '')
const TOKEN = process.env.PALMOS_AGENT_TOKEN?.trim()
const ALLOWLIST = (process.env.PALMOS_MCP_TOOLS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const log = (...args: unknown[]): void => console.error('[palmos-mcp]', ...args)

if (!TOKEN) {
  log('FATAL: set PALMOS_AGENT_TOKEN to an issued palmos_... agent credential (from the PalmOS dashboard).')
  process.exit(1)
}

const authHeaders = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
}

type SdkTool = { name: string; description?: string; inputSchema?: Record<string, unknown> }

async function fetchTools(): Promise<SdkTool[]> {
  const res = await fetch(`${API}/api/sdk/v1/tools`, { headers: authHeaders })
  if (!res.ok) throw new Error(`GET /api/sdk/v1/tools → ${res.status}`)
  const body = (await res.json()) as { tools?: SdkTool[] }
  let tools = body.tools ?? []
  if (ALLOWLIST.length) tools = tools.filter((t) => ALLOWLIST.includes(t.name))
  return tools
}

const server = new Server(
  { name: 'palmos', version: '0.2.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    const tools = await fetchTools()
    log(`exposing ${tools.length} governed tools: ${tools.map((t) => t.name).join(', ')}`)
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: (t.inputSchema as { type: 'object' }) ?? { type: 'object' },
      })),
    }
  } catch (error) {
    log('list-tools failed (is PALMOS_API_URL reachable + the token valid?):', (error as Error).message)
    return { tools: [] }
  }
})

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    const res = await fetch(`${API}/api/sdk/v1/tools/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(args),
    })
    const raw = await res.text()
    let text = raw
    try {
      text = JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      // non-JSON body — return as-is
    }
    // A policy denial (HTTP 403) is a legitimate governed outcome: surface it as an error the agent
    // reads and reasons about, rather than a silent success.
    return { content: [{ type: 'text' as const, text }], isError: !res.ok }
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `PalmOS MCP bridge call failed: ${(error as Error).message}` }],
      isError: true,
    }
  }
})

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  log(`connected — proxying governed PalmOS tools from ${API}`)
}

main().catch((error) => {
  log('fatal:', error instanceof Error ? error.message : error)
  process.exit(1)
})
