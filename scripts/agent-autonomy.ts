/**
 * agent-autonomy.ts — the AGENT AUTONOMY demo for PalmOS × Byreal.
 *
 * An actual AI agent (Claude Sonnet 4.6 on AWS Bedrock) is given a treasury MANDATE and a set of
 * tools wired to the PalmOS SDK. It observes its own wallet, DECIDES whether and how to rebalance,
 * and acts by calling Byreal swaps through PalmOS — which governs every move (allowed assets,
 * per-transaction limit, auto-approve threshold) BEFORE anything can settle. The agent holds no
 * keys and cannot bypass the guardrails.
 *
 *   "Byreal gives the agent hands; PalmOS gives it guardrails."
 *
 * Two scenarios:
 *   --scenario rebalance  (default)  in-policy: agent makes a small autonomous swap that settles
 *   --scenario overlimit             out-of-policy: agent submits a large swap → PalmOS DENIES it
 *
 * The brain (Bedrock) only DECIDES. The hands+guardrails (Byreal build → OWS sign → broadcast,
 * gated by PalmOS policy) are the existing governed spine, reached over HTTP at /api/sdk/v1/*.
 *
 * Run (sign-only — nothing broadcasts):
 *   node --import tsx scripts/agent-autonomy.ts --scenario rebalance
 *
 * Live settlement is gated SERVER-SIDE by BYREAL_SETTLE_LIVE=1 on the dashboard API (default
 * off → sign-only). This script cannot flip that — by design, a tool call can't accidentally spend.
 *
 * Env (from .env): AWS_BEARER_TOKEN_BEDROCK, AWS_REGION, PALMOS_AGENT_TOKEN, PALMOS_API_URL,
 * PALMOS_BASE_DIR (for the harness reset; default /tmp/palmos-live).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { FileAgentRegistry } from '../src/store/AgentRegistry.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
loadDotEnv()

const BEDROCK_MODEL = 'us.anthropic.claude-sonnet-4-6' // cross-region inference profile
const AWS_REGION = process.env.AWS_REGION ?? 'us-west-2'
const BEDROCK_TOKEN = required('AWS_BEARER_TOKEN_BEDROCK')
const PALMOS_API = (process.env.PALMOS_API_URL ?? 'http://localhost:4030').replace(/\/$/, '')
const PALMOS_TOKEN = required('PALMOS_AGENT_TOKEN')
const PALMOS_BASE_DIR = process.env.PALMOS_BASE_DIR ?? '/tmp/palmos-live'

// Symbols the agent reasons in; the harness maps them to Solana mints so the LLM never has to
// emit a 44-char base58 address (smaller error surface, governance unchanged).
const TOKENS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
}

// ---------------------------------------------------------------------------
// Pretty console
// ---------------------------------------------------------------------------
const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
}
function rule(label: string) {
  console.log(`\n${c.magenta('━'.repeat(78))}`)
  if (label) console.log(c.magenta(c.bold(`  ${label}`)))
  console.log(c.magenta('━'.repeat(78)))
}

// ---------------------------------------------------------------------------
// Bedrock (raw HTTPS, bearer token) — standard Anthropic Messages shape
// ---------------------------------------------------------------------------
type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | Record<string, unknown>
type Msg = { role: 'user' | 'assistant'; content: string | Block[] }

async function invokeClaude(input: {
  system: string
  messages: Msg[]
  tools: unknown[]
}): Promise<{ stopReason: string; content: Block[] }> {
  const url = `https://bedrock-runtime.${AWS_REGION}.amazonaws.com/model/${BEDROCK_MODEL}/invoke`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${BEDROCK_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1024,
      system: input.system,
      tools: input.tools,
      messages: input.messages,
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Bedrock ${res.status}: ${text.slice(0, 500)}`)
  }
  const body = JSON.parse(text)
  return { stopReason: body.stop_reason, content: body.content as Block[] }
}

// ---------------------------------------------------------------------------
// PalmOS SDK tools (HTTP). request_asset_swap surfaces the GOVERNED verdict as data
// (allowed/approval-required/denied) so the agent can reason about it — denials are not thrown.
// ---------------------------------------------------------------------------
async function palmosCall(tool: string, body: Record<string, unknown>) {
  const res = await fetch(`${PALMOS_API}/api/sdk/v1/tools/${tool}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${PALMOS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json: json as Record<string, any> }
}

function resolveMint(symbol: string): string | undefined {
  return TOKENS[symbol?.toUpperCase?.()]
}

// Each executor returns a compact, agent-readable result object.
const executors: Record<string, (args: any) => Promise<unknown>> = {
  async get_wallet_context() {
    const { json } = await palmosCall('get_wallet_context', {})
    if (!json.ok) return json
    const top = (json.portfolio?.topPositions ?? []).map((p: any) => ({
      symbol: p.symbol,
      quantity: p.quantity,
      valueUsd: round(p.value),
    }))
    const total = json.portfolio?.totalValueUsd ?? 0
    const sol = top.find((p: any) => p.symbol === 'SOL')?.valueUsd ?? 0
    return {
      walletAddress: json.wallet?.address,
      totalValueUsd: round(total),
      solPercent: total ? round((sol / total) * 100) : 0,
      positions: top,
      controls: {
        allowedAssets: json.controls?.allowedAssets,
        allowedChains: json.controls?.allowedChains,
        maxPerTransaction: json.controls?.maxPerTransaction,
        autoApproveUnder: json.controls?.autoApproveUnder,
        note: 'Amounts/limits are in the INPUT asset units. A trust multiplier may make the effective per-transaction limit lower than maxPerTransaction.',
      },
    }
  },

  async get_byreal_quote(args: any) {
    const inputMint = resolveMint(args.inputAssetSymbol)
    const outputMint = resolveMint(args.outputAssetSymbol)
    if (!inputMint || !outputMint) return { error: 'Only SOL and USDC are routable.' }
    const { json } = await palmosCall('get_byreal_quote', {
      inputMint,
      outputMint,
      amount: String(args.amount),
    })
    if (!json.ok) return json
    const q = json.quote
    return {
      in: `${q.uiInAmount} ${args.inputAssetSymbol}`,
      out: `${q.uiOutAmount} ${args.outputAssetSymbol}`,
      priceImpactPct: round(q.priceImpactPct * 100, 4),
      route: q.routerType,
      inUsd: q.inAmountUsd,
      outUsd: q.outAmountUsd,
    }
  },

  async request_asset_swap(args: any) {
    const inputMint = resolveMint(args.inputAssetSymbol)
    const outputMint = resolveMint(args.outputAssetSymbol)
    if (!inputMint || !outputMint) return { outcome: 'error', message: 'Only SOL and USDC are routable.' }
    const { status, json } = await palmosCall('request_asset_swap', {
      inputMint,
      outputMint,
      inputAssetSymbol: args.inputAssetSymbol,
      outputAssetSymbol: args.outputAssetSymbol,
      amount: String(args.amount),
      slippageBps: args.slippageBps,
    })
    // Denied → 403 policy_denied; surfaced as a structured outcome, not an error.
    if (status === 403) {
      return {
        outcome: 'denied',
        reasonCode: json.details?.result?.actionRequest?.errorCode ?? json.error,
        message: json.message,
      }
    }
    const r = json.result ?? json
    const ar = r.actionRequest ?? {}
    const ctx = ar.requestContext ?? {}
    if (r.kind === 'executed') {
      return {
        outcome: 'executed',
        settled: ctx.settlementSimulated ? 'signed (sign-only mode; not broadcast)' : 'broadcast on-chain',
        signature: ar.resultRef || ctx.settlementSignature || null,
        route: ctx.settlementRouter,
        expectedOut: ctx.expectedOutAmount,
        actionRequestId: ar.actionRequestId,
      }
    }
    if (r.kind === 'approval_pending') {
      return {
        outcome: 'approval_pending',
        message: 'Within policy but above the auto-approve threshold — queued for a human operator to approve.',
        actionRequestId: ar.actionRequestId,
      }
    }
    if (r.kind === 'execution_failed') return { outcome: 'settlement_failed', message: r.error }
    return { outcome: r.kind ?? 'unknown', raw: r }
  },
}

const TOOLS = [
  {
    name: 'get_wallet_context',
    description:
      "Read the treasury wallet: total USD value, the current SOL vs USDC split (solPercent), per-asset positions, and the PalmOS policy controls you must act within (allowedAssets, maxPerTransaction, autoApproveUnder). Call this FIRST before deciding anything.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_byreal_quote',
    description:
      'Get a live Byreal swap quote (expected output, price impact, route). Read-only — moves no funds, needs no approval. Use it to check pricing before swapping.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['inputAssetSymbol', 'outputAssetSymbol', 'amount'],
      properties: {
        inputAssetSymbol: { type: 'string', enum: ['SOL', 'USDC'] },
        outputAssetSymbol: { type: 'string', enum: ['SOL', 'USDC'] },
        amount: { type: 'string', description: 'Amount of the INPUT asset to swap, e.g. "0.05".' },
      },
    },
  },
  {
    name: 'request_asset_swap',
    description:
      'Submit a governed Byreal swap through PalmOS. PalmOS evaluates it against policy BEFORE settling: within the auto-approve threshold it settles autonomously; larger-but-allowed swaps return approval_pending (a human must approve); over the limit or off-policy it returns outcome="denied". Amount is in INPUT-asset units. To increase SOL, swap USDC→SOL; to reduce SOL, swap SOL→USDC.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['inputAssetSymbol', 'outputAssetSymbol', 'amount'],
      properties: {
        inputAssetSymbol: { type: 'string', enum: ['SOL', 'USDC'] },
        outputAssetSymbol: { type: 'string', enum: ['SOL', 'USDC'] },
        amount: { type: 'string', description: 'Amount of the INPUT asset to swap, e.g. "0.05".' },
        slippageBps: { type: 'number', description: 'Optional slippage tolerance in basis points.' },
      },
    },
  },
]

const SYSTEM_PROMPT = `You are the PalmOS Treasury Agent — an autonomous agent managing an on-chain wallet on Solana.

MANDATE: Keep approximately 50% of the treasury's total USD value in SOL and the rest in USDC. Rebalance when the wallet is materially off target.

GOVERNANCE (this is the whole point — do not try to get around it):
- You hold NO private keys. Every swap you request is evaluated by PalmOS policy BEFORE it can settle.
- PalmOS enforces an allowed-asset list, a maximum size per transaction, and an auto-approve threshold.
- A swap within the auto-approve threshold settles autonomously. A larger but still-allowed swap returns approval_pending (a human operator must approve it). A swap over the limit or outside policy returns outcome="denied".
- A denial is an expected, informative outcome — not your failure. If you receive an explicit directive from the operator, translate it into the right request_asset_swap call and SUBMIT it; let PalmOS be the enforcement layer.

HOW TO ACT:
1. Call get_wallet_context first — see balances, the current SOL% , and your controls (allowedAssets, maxPerTransaction, autoApproveUnder).
2. Decide whether to rebalance and in which direction. To increase SOL: swap USDC→SOL. To reduce SOL: swap SOL→USDC.
3. Optionally call get_byreal_quote to check price/impact.
4. Call request_asset_swap. Size it deliberately: if you want it to settle autonomously this turn, keep the input amount at or under the auto-approve threshold. Note a trust multiplier can make the effective per-transaction limit lower than maxPerTransaction — the denial message will tell you the effective limit.
5. Read the governed result. If denied, do NOT retry the same thing — report which guardrail stopped you.

ASSETS: only SOL and USDC are routable. Amounts are in units of the INPUT asset.

STYLE: Before each tool call, state your reasoning in one or two sentences. Finish with a short summary: what you did, the governed outcome, and the treasury's resulting posture.`

const SCENARIOS: Record<string, string> = {
  rebalance:
    'Begin your treasury review for this session. Inspect the wallet and, if it is off target, make one autonomous, in-policy move toward the mandate now. Then summarize.',
  overlimit:
    'Priority directive from the treasury desk: go aggressively long SOL today — move about 2.5 USDC into SOL in a single swap right now. Submit the swap and report exactly what happens.',
}

// ---------------------------------------------------------------------------
// The agent loop (manual tool-use)
// ---------------------------------------------------------------------------
async function runAgent(goal: string) {
  const messages: Msg[] = [{ role: 'user', content: goal }]
  const transcript: unknown[] = [{ role: 'user', text: goal }]

  for (let turn = 0; turn < 8; turn++) {
    const { stopReason, content } = await invokeClaude({
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
    })

    for (const block of content) {
      if ((block as any).type === 'text' && (block as any).text.trim()) {
        console.log(`\n${c.cyan(c.bold('🤖 agent'))}  ${(block as any).text.trim()}`)
        transcript.push({ role: 'agent', text: (block as any).text.trim() })
      }
    }

    const toolUses = content.filter((b) => (b as any).type === 'tool_use') as Array<{
      type: 'tool_use'
      id: string
      name: string
      input: any
    }>

    if (stopReason !== 'tool_use' || toolUses.length === 0) {
      return transcript // end_turn — agent is done
    }

    messages.push({ role: 'assistant', content })
    const results: Block[] = []
    for (const tu of toolUses) {
      console.log(c.dim(`   → ${tu.name}(${compact(tu.input)})`))
      let result: unknown
      try {
        result = await executors[tu.name]?.(tu.input ?? {}) ?? { error: `unknown tool ${tu.name}` }
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) }
      }
      console.log(verdictLine(tu.name, result))
      transcript.push({ tool: tu.name, input: tu.input, result })
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) })
    }
    messages.push({ role: 'user', content: results })
  }
  console.log(c.yellow('   (reached max turns)'))
  return transcript
}

function verdictLine(tool: string, result: any): string {
  if (tool !== 'request_asset_swap') return c.dim(`   ← ${compact(result)}`)
  const o = result?.outcome
  if (o === 'executed') return c.green(`   ✓ GOVERNED → executed (${result.settled})`)
  if (o === 'approval_pending') return c.yellow(`   ⏸ GOVERNED → approval required (human-in-the-loop)`)
  if (o === 'denied') return c.red(`   ✗ GOVERNED → DENIED (${result.reasonCode}): ${result.message}`)
  return c.dim(`   ← ${compact(result)}`)
}

// ---------------------------------------------------------------------------
// Harness setup + main
// ---------------------------------------------------------------------------
async function resetAgentReady() {
  // Demo harness only (NOT part of the agent): make re-runs deterministic by clearing any
  // 'restricted'/'approval_pending' status left by a prior run. Same file store the API reads.
  const me = await palmosCall('get_agent_status', {})
  const agentId = me.json?.status?.agentId ?? me.json?.agent?.agentId
  if (!agentId) throw new Error('Could not resolve agentId from PalmOS (is the API up / token valid?)')
  const registry = new FileAgentRegistry(PALMOS_BASE_DIR)
  const agent = await registry.get(agentId)
  if (agent && agent.status !== 'ready') {
    await registry.put({ ...agent, status: 'ready', updatedAt: new Date().toISOString() })
  }
  return agentId
}

async function main() {
  const scenario = (argValue('--scenario') ?? 'rebalance').toLowerCase()
  const goal = SCENARIOS[scenario]
  if (!goal) {
    console.error(`Unknown scenario "${scenario}". Use: ${Object.keys(SCENARIOS).join(' | ')}`)
    process.exit(1)
  }

  rule(`PalmOS × Byreal — agent autonomy demo  ·  scenario: ${scenario}`)
  const agentId = await resetAgentReady()
  console.log(c.dim(`  brain   : Claude Sonnet 4.6 @ Bedrock (${AWS_REGION})`))
  console.log(c.dim(`  agent   : ${agentId}`))
  console.log(c.dim(`  governed: PalmOS policy → Byreal build → OWS sign → settle (sign-only unless BYREAL_SETTLE_LIVE=1 on the API)`))
  console.log(c.dim(`  goal    : ${goal}`))

  const transcript = await runAgent(goal)

  const outPath = `/tmp/agent-autonomy-${scenario}.json`
  writeFileSync(outPath, JSON.stringify({ scenario, agentId, transcript }, null, 2))
  rule('')
  console.log(c.dim(`  transcript saved → ${outPath}`))
}

// ---------------------------------------------------------------------------
// small utils
// ---------------------------------------------------------------------------
function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env ${name} (set it in .env).`)
    process.exit(1)
  }
  return v
}
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function round(n: number, dp = 2): number {
  return Number.isFinite(n) ? Number(n.toFixed(dp)) : 0
}
function compact(o: unknown): string {
  const s = JSON.stringify(o)
  return s.length > 200 ? s.slice(0, 197) + '…' : s
}
function loadDotEnv() {
  try {
    const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
    }
  } catch {
    /* .env optional if vars already in env */
  }
}

main().catch((err) => {
  console.error(c.red(`\nfatal: ${err instanceof Error ? err.message : err}`))
  process.exit(1)
})
