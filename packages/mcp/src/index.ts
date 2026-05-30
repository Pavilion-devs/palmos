#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { PalmosAgentClient, PalmosAgentClientError } from '@getpalmos/agent'

// Lazily build the client so the server can start and advertise its tools even
// when no credential is set yet. Tool *calls* still require PALMOS_AGENT_TOKEN.
let client: PalmosAgentClient | undefined

function getClient(): PalmosAgentClient {
  if (client) {
    return client
  }

  const token = process.env.PALMOS_AGENT_TOKEN?.trim()
  if (!token) {
    throw new Error(
      'Set PALMOS_AGENT_TOKEN to an issued palmos_... SDK credential (from the PalmOS dashboard).',
    )
  }

  client = new PalmosAgentClient({
    baseUrl: process.env.PALMOS_API_URL?.trim(),
    token,
  })
  return client
}

type ToolResult = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function fail(error: unknown): ToolResult {
  const message =
    error instanceof PalmosAgentClientError
      ? `PalmOS API error ${error.status}: ${error.message}`
      : error instanceof Error
        ? error.message
        : String(error)
  return { isError: true, content: [{ type: 'text', text: message }] }
}

const server = new McpServer({ name: 'palmos', version: '0.1.0' })

server.registerTool(
  'palmos_list_services',
  {
    title: 'List PalmOS paid services',
    description:
      'List the paid services this PalmOS agent is allowed to call, with vendor, settlement asset, expected amount, payment rail, and whether each is currently allowed by policy. Call this first to discover valid serviceId values.',
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await getClient().listServices())
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'palmos_get_agent_status',
  {
    title: 'Get PalmOS agent status',
    description:
      "Return this agent's PalmOS identity and posture: agent and credential status, trust tier, settlement mode, and wallet state.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await getClient().getAgentStatus())
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'palmos_check_policy',
  {
    title: 'Check PalmOS payment policy',
    description:
      'Preview whether a payment for a service (and optional amount) would be allowed, approval-gated, or denied — WITHOUT spending anything. Use this before palmos_pay to avoid surprises.',
    inputSchema: {
      serviceId: z
        .string()
        .describe('PalmOS service id, e.g. local.pusd.spot_price'),
      amount: z
        .string()
        .optional()
        .describe('Optional amount override as a decimal string, e.g. "0.25".'),
    },
  },
  async ({ serviceId, amount }) => {
    try {
      return ok(await getClient().checkPolicy({ serviceId, amount }))
    } catch (error) {
      return fail(error)
    }
  },
)

server.registerTool(
  'palmos_pay',
  {
    title: 'Execute a governed PalmOS payment',
    description:
      'Request a governed paid-service call. PalmOS enforces policy, session budget, vendor allowlist, and approval gates server-side: small allowed payments execute immediately, higher-value ones become approval-pending for an operator, and disallowed services/vendors are blocked. The agent never holds wallet keys. Returns the execution record; check result.kind (executed | approval_pending | waiting_for_execution | blocked | execution_failed). Pass a stable idempotencyKey derived from a job/run id so retries do not double-pay.',
    inputSchema: {
      serviceId: z.string().describe('PalmOS service id to pay for.'),
      request: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Service request payload, e.g. { "base": "BTC", "quote": "USD" }.'),
      amount: z
        .string()
        .optional()
        .describe('Optional amount override as a decimal string.'),
      note: z
        .string()
        .optional()
        .describe('Optional human-readable note stored on the paid-call record.'),
      idempotencyKey: z
        .string()
        .optional()
        .describe('Stable key from a job/run id so retries are not double-charged.'),
      privacy: z
        .enum(['default', 'required'])
        .optional()
        .describe(
          'Set "required" to force private (Umbra) settlement; fails closed if no private route is configured.',
        ),
    },
  },
  async (input) => {
    try {
      return ok(await getClient().pay(input))
    } catch (error) {
      return fail(error)
    }
  },
)

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdout is the JSON-RPC channel; log to stderr only.
  console.error('[palmos-mcp] PalmOS MCP server ready on stdio.')
}

main().catch((error) => {
  console.error(
    '[palmos-mcp] fatal:',
    error instanceof Error ? error.message : error,
  )
  process.exit(1)
})
