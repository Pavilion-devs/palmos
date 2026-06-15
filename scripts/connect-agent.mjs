// PalmOS — interactive "connect an agent" CLI.
//
// Run it, paste your agent token when prompted, press Enter. It authenticates the agent (which
// brings it online on the dashboard) and shows the governed tools it can use. No keys, no spend.
//
//   node scripts/connect-agent.mjs
//
// Backend defaults to the hosted API (https://api.getpalmos.xyz). To point at a self-hosted backend,
// set PALMOS_API_URL (then it won't ask). A token in PALMOS_AGENT_TOKEN skips the prompt too.

import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  lime: '\x1b[38;5;154m', cyan: '\x1b[36m', red: '\x1b[31m', gray: '\x1b[90m',
}
const line = (s = '') => console.log(s)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

let API = process.env.PALMOS_API_URL?.trim()
if (!API) {
  const ans = (await rl.question(`  ${C.cyan}Backend${C.reset} ${C.dim}[https://api.getpalmos.xyz]${C.reset} › `)).trim()
  API = ans || 'https://api.getpalmos.xyz'
}
API = API.replace(/\/$/, '')
rl.close()

const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const get = async (p) => {
  const r = await fetch(`${API}${p}`, { headers: auth })
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }
}

output.write(`\n  ${C.dim}🔌 connecting…${C.reset}`)
await sleep(500)

// The first authenticated call brings the agent online on the dashboard.
const me = await get('/api/sdk/v1/me')
if (!me.ok) {
  line(`\r  ${C.red}✗ couldn't connect${C.reset} ${C.dim}(${me.status})${C.reset}  ${me.body?.message ?? me.body?.error ?? ''}        \n`)
  process.exit(1)
}
const name = me.body?.agent?.displayName ?? me.body?.agent?.agentId ?? 'your agent'
line(`\r  ${C.lime}✓${C.reset} ${C.bold}${name}${C.reset} is online — governed by PalmOS policy.            \n`)

const tools = await get('/api/sdk/v1/tools')
const names = (tools.body?.tools ?? []).map((t) => t.name)
if (names.length) {
  line(`  ${C.gray}governed tools it can call:${C.reset}`)
  for (const n of names) line(`    ${C.lime}•${C.reset} ${n}`)
  line('')
}
line(`  ${C.gray}It holds no keys — every action runs through PalmOS:${C.reset}`)
line(`  ${C.gray}policy check → vault signature → on-chain audit.${C.reset}\n`)
line(`  ${C.cyan}→${C.reset} open your dashboard — ${C.bold}${name}${C.reset} is now connected.\n`)
