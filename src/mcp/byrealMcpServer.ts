/**
 * PalmOS Byreal MCP server — a generic bridge exposing PalmOS's governed SDK tools to any MCP client
 * (e.g. a live Claude Code session that IS the agent). It reads the live tool catalog from
 * `GET /api/sdk/v1/tools` and proxies each call to `POST /api/sdk/v1/tools/:toolName` with the
 * agent's bearer token. New SDK tools surface automatically — including the governed Byreal skills
 * (`get_byreal_quote`, `request_asset_swap`, `request_liquidity_action`, `list_byreal_positions`).
 *
 * The agent reaches PalmOS *only* through this bridge; PalmOS governs every call (policy gate, OWS
 * custody, Mantle decision log). The bridge holds no keys and cannot bypass policy — a denied action
 * comes back as an error the agent reads and reasons about.
 *
 * Env (auto-loaded from .env): PALMOS_API_URL (default http://localhost:4030),
 *   PALMOS_AGENT_TOKEN (required — mint with scripts/mint-agent-token.ts),
 *   PALMOS_MCP_TOOLS (optional comma-separated allowlist of tool names).
 *
 * Launch via Claude Code's .mcp.json (command: node --import tsx src/mcp/byrealMcpServer.ts).
 * NOTE: stdout is the MCP JSON-RPC channel — all logging goes to stderr.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

// Pick up .env (PALMOS_AGENT_TOKEN, PALMOS_API_URL) when launched by an MCP client.
try {
  ;(process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.()
} catch {
  // no .env — rely on the ambient environment
}

const API = (process.env.PALMOS_API_URL ?? 'http://localhost:4030').replace(/\/$/, '')
const TOKEN = process.env.PALMOS_AGENT_TOKEN?.trim()
const ALLOWLIST = (process.env.PALMOS_MCP_TOOLS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const log = (...args: unknown[]) => console.error('[palmos-mcp]', ...args)

if (!TOKEN) {
  log('FATAL: PALMOS_AGENT_TOKEN is required (mint one with scripts/mint-agent-token.ts).')
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
  { name: 'palmos-byreal', version: '0.1.0' },
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
    log('list-tools failed (is the PalmOS API running?):', (error as Error).message)
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
    return { content: [{ type: 'text', text }], isError: !res.ok }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `PalmOS MCP bridge call failed: ${(error as Error).message}` }],
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
log(`connected — proxying governed PalmOS tools from ${API}`)
