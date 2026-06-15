#!/usr/bin/env node
// @getpalmos/agent CLI — bring an agent online from the terminal.
//
//   npx @getpalmos/agent connect
//
// Prompts for the agent token (from the dashboard's "Bring it online" screen), authenticates it
// (which connects the agent), and lists the governed tools it can use. No keys, no spend.
// Env: PALMOS_AGENT_TOKEN (skip the prompt) · PALMOS_API_URL (self-hosted backend).

import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  lime: '\x1b[38;5;154m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
}
const line = (s = ''): void => console.log(s)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const DEFAULT_API = 'https://api.getpalmos.xyz'

type Json = Record<string, unknown>

function help(): void {
  line(`\n  ${C.bold}@getpalmos/agent${C.reset} ${C.dim}— connect an agent to PalmOS${C.reset}\n`)
  line(`  ${C.cyan}npx @getpalmos/agent connect${C.reset}   ${C.dim}bring an agent online (interactive)${C.reset}`)
  line(
    `\n  ${C.dim}env:${C.reset} PALMOS_AGENT_TOKEN ${C.dim}(skip the prompt)${C.reset} · PALMOS_API_URL ${C.dim}(self-hosted backend)${C.reset}\n`,
  )
}

async function connect(): Promise<void> {
  line(`\n  ${C.bold}PalmOS${C.reset} ${C.dim}· connect an agent${C.reset}`)
  line(`  ${C.gray}Paste the token from your agent's "Bring it online" screen.${C.reset}\n`)

  const rl = readline.createInterface({ input, output })
  let token = process.env.PALMOS_AGENT_TOKEN?.trim()
  if (!token) token = (await rl.question(`  ${C.cyan}Agent token${C.reset} › `)).trim()
  if (!token) {
    line(`\n  ${C.red}No token entered — nothing to connect.${C.reset}\n`)
    rl.close()
    process.exit(1)
  }
  let api = process.env.PALMOS_API_URL?.trim()
  if (!api) {
    const answer = (await rl.question(`  ${C.cyan}Backend${C.reset} ${C.dim}[${DEFAULT_API}]${C.reset} › `)).trim()
    api = answer || DEFAULT_API
  }
  api = api.replace(/\/$/, '')
  rl.close()

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const get = async (path: string): Promise<{ ok: boolean; status: number; body: Json }> => {
    const res = await fetch(`${api}${path}`, { headers })
    return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as Json }
  }

  output.write(`\n  ${C.dim}🔌 connecting…${C.reset}`)
  await sleep(500)

  // The first authenticated call brings the agent online on the dashboard.
  const me = await get('/api/sdk/v1/me')
  if (!me.ok) {
    const detail = (me.body.message ?? me.body.error ?? '') as string
    line(`\r  ${C.red}✗ couldn't connect${C.reset} ${C.dim}(${me.status})${C.reset}  ${detail}        \n`)
    process.exit(1)
  }
  const agent = (me.body.agent ?? {}) as Json
  const name = (agent.displayName ?? agent.agentId ?? 'your agent') as string
  line(`\r  ${C.lime}✓${C.reset} ${C.bold}${name}${C.reset} is online — governed by PalmOS policy.            \n`)

  const tools = await get('/api/sdk/v1/tools')
  const names = ((tools.body.tools ?? []) as Array<{ name: string }>).map((t) => t.name)
  if (names.length) {
    line(`  ${C.gray}governed tools it can call:${C.reset}`)
    for (const n of names) line(`    ${C.lime}•${C.reset} ${n}`)
    line('')
  }
  line(`  ${C.gray}It holds no keys — every action runs through PalmOS:${C.reset}`)
  line(`  ${C.gray}policy check → vault signature → on-chain audit.${C.reset}\n`)
  line(`  ${C.cyan}→${C.reset} open your dashboard — ${C.bold}${name}${C.reset} is now connected.\n`)
}

const cmd = process.argv[2]
if (cmd === '-h' || cmd === '--help') {
  help()
} else if (cmd && cmd !== 'connect') {
  line(`\n  ${C.red}Unknown command: ${cmd}${C.reset}`)
  help()
  process.exit(1)
} else {
  await connect()
}
