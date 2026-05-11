import { createInterface } from 'node:readline/promises'
import { stdin, stdout, argv, exit } from 'node:process'
import { loadProcessEnv } from '../env/loadProcessEnv.js'

const B = '\x1b[1m'
const D = '\x1b[2m'
const G = '\x1b[32m'
const C = '\x1b[36m'
const R = '\x1b[31m'
const X = '\x1b[0m'
const env = loadProcessEnv()

const BUILT_IN_SERVICES = [
  {
    id: 'local.pusd.spot_price',
    label: 'Spot price data',
    amount: '0.01 PUSD',
    note: 'auto-approved at default threshold',
  },
  {
    id: 'local.pusd.ops_brief',
    label: 'Market ops brief',
    amount: '0.25 PUSD',
    note: 'approval-required above 0.05 PUSD threshold',
  },
]

function readFlag(name: string): string | undefined {
  const exact = `--${name}`
  const prefixed = `--${name}=`
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (!v) continue
    if (v === exact) return argv[i + 1]
    if (v.startsWith(prefixed)) return v.slice(prefixed.length)
  }
  return undefined
}

function readApiUrl(): string {
  return (
    readFlag('api-url') ??
    env.PALMOS_API_URL?.replace(/\/$/, '') ??
    'http://127.0.0.1:4030'
  )
}

function hr(): void {
  console.log(`${D}${'─'.repeat(70)}${X}`)
}

function parseAmount(value: string, fallback: string): string {
  const clean = value.trim().replace(/[^0-9.]/g, '')
  const parsed = Number(clean)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed.toFixed(6).replace(/\.?0+$/, '')
}

function parseServiceChoices(raw: string): string[] {
  if (!raw.trim() || raw.trim().toLowerCase() === 'all') {
    return BUILT_IN_SERVICES.map((s) => s.id)
  }
  const indices = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((i) => i >= 0 && i < BUILT_IN_SERVICES.length)
  return indices.length > 0
    ? indices.map((i) => BUILT_IN_SERVICES[i]!.id)
    : BUILT_IN_SERVICES.map((s) => s.id)
}

function parseWalletMode(raw: string): string {
  const v = raw.trim()
  if (v === '2' || /\bows\b/i.test(v)) return 'ows'
  if (v === '3' || /real|solana|mainnet/i.test(v)) return 'real-solana'
  return 'local-demo'
}

async function main(): Promise<void> {
  const apiUrl = readApiUrl()
  const rl = createInterface({ input: stdin, output: stdout })

  console.log()
  hr()
  console.log(`${B}  PalmOS Init${X}  —  governed payment control for external AI agents`)
  hr()
  console.log()
  console.log(`  ${D}Backend: ${apiUrl}${X}`)
  console.log()
  console.log(
    '  Answer a few questions to register an external agent with a governed PUSD',
  )
  console.log('  payment profile and issue SDK credentials.')
  console.log()

  // Agent name
  const agentName =
    (await rl.question(`  ${B}External agent name${X} ${D}[External Agent]${X}: `)).trim() ||
    'External Agent'

  // Task
  console.log()
  console.log(`  ${B}Which paid services should this external agent be allowed to use?${X}`)
  const agentTask =
    (await rl.question('  > ')).trim() ||
    'Execute governed PUSD API calls'

  // Policy amounts
  console.log()
  const rawMax = await rl.question(
    `  ${B}Max PUSD per API call${X} ${D}[0.05]${X}: `,
  )
  const maxPerCall = parseAmount(rawMax, '0.05')

  const rawBudget = await rl.question(
    `  ${B}Session budget in PUSD${X} ${D}[1.00]${X}: `,
  )
  const sessionBudget = parseAmount(rawBudget, '1.00')

  const rawAuto = await rl.question(
    `  ${B}Auto-approve under PUSD${X} ${D}[0.05]${X}: `,
  )
  const autoApproveUnder = parseAmount(rawAuto, '0.05')

  // Services
  console.log()
  console.log(`  ${B}Available services:${X}`)
  for (let i = 0; i < BUILT_IN_SERVICES.length; i++) {
    const svc = BUILT_IN_SERVICES[i]!
    console.log(
      `    [${i + 1}] ${C}${svc.id}${X}`,
    )
    console.log(
      `        ${svc.label}  ${D}${svc.amount}  —  ${svc.note}${X}`,
    )
  }
  console.log()
  const rawServices = await rl.question(
    `  Allow services (numbers or 'all') ${D}[all]${X}: `,
  )
  const allowedVendors = parseServiceChoices(rawServices)

  // Wallet mode
  console.log()
  console.log(`  ${B}Wallet mode:${X}`)
  console.log(`    [1] ${B}local-demo${X}  — Service-test settlement, no real PUSD needed`)
  console.log(`    [2] ows         — OWS governed wallet`)
  console.log(`    [3] real-solana — Real Solana PUSD settlement`)
  console.log()
  const rawMode = await rl.question(`  Choose mode ${D}[1]${X}: `)
  const walletMode = parseWalletMode(rawMode)

  // Manager address
  console.log()
  console.log(
    `  ${B}XMTP manager address${X} ${D}(optional — for approval alerts)${X}`,
  )
  const managerAddress = (await rl.question('  > ')).trim()

  rl.close()

  // Register agent payment profile on backend
  console.log()
  process.stdout.write(`  Registering external agent on PalmOS backend...`)

  let res: Response
  try {
    res = await fetch(`${apiUrl}/api/dashboard/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setup: {
          agentName,
          agentTask,
          maxPerCall,
          sessionBudget,
          autoApproveUnder,
          allowedVendors,
          walletMode,
          managerAddress: managerAddress || undefined,
        },
      }),
    })
  } catch {
    console.log(` ${R}✗${X}`)
    console.log()
    console.log(`  ${R}Could not reach PalmOS backend at ${apiUrl}${X}`)
    console.log(
      `  Start it first: ${D}npm run dashboard:api${X}`,
    )
    console.log()
    exit(1)
  }

  type CreatePayload = {
    ok: boolean
    error?: string
    agent?: { agentId: string; displayName?: string }
    credential?: { credentialId: string; keyPrefix: string }
    token?: string
  }

  const payload = (await res.json().catch(() => null)) as CreatePayload | null

  if (!res.ok || !payload?.ok) {
    console.log(` ${R}✗${X}`)
    console.log()
    console.log(
      `  ${R}Failed: ${payload?.error ?? 'unexpected backend error'}${X}`,
    )
    console.log()
    exit(1)
  }

  console.log(` ${G}✓${X}`)

  const agent = payload.agent
  const token = payload.token

  if (!agent?.agentId || !token) {
    console.log()
    console.log(`  ${R}Backend returned an incomplete response.${X}`)
    exit(1)
  }

  const primaryService = allowedVendors[0] ?? 'local.pusd.spot_price'

  // Print result
  console.log()
  hr()
  console.log()
  console.log(
    `  ${G}${B}Agent registered:${X} ${agent.displayName ?? agentName}`,
  )
  console.log(`  ${D}ID: ${agent.agentId}${X}`)
  console.log()
  console.log(`  ${B}Copy these env vars into your agent or .env file:${X}`)
  console.log()
  console.log(`    ${C}PALMOS_API_URL=${apiUrl}${X}`)
  console.log(`    ${C}PALMOS_AGENT_TOKEN=${token}${X}`)
  console.log(`    ${C}PALMOS_SERVICE_ID=${primaryService}${X}`)
  console.log()
  if (walletMode === 'ows') {
    console.log(
      `  ${B}OWS mode:${X} this agent requires an attached OWS Solana wallet`,
    )
    console.log(
      `  with SOL for fees and PUSD for settlement. Run ${D}npm run palmos:readiness${X}`,
    )
    console.log('  before the live demo.')
    console.log()
  } else if (walletMode === 'real-solana') {
    console.log(
      `  ${B}Real Solana mode:${X} set ${C}PUSD_AGENT_KEYPAIR_PATH${X} or`,
    )
    console.log(
      `  ${C}PUSD_AGENT_PRIVATE_KEY${X} on the backend before executing paid calls.`,
    )
    console.log()
  }
  console.log(
    `  ${D}Token is shown once. Copy it now — it cannot be retrieved again.${X}`,
  )
  console.log()
  hr()
  console.log()
  console.log(`  ${B}Test immediately:${X}`)
  console.log(`    ${D}npm run palmos:external-agent${X}`)
  console.log()
  console.log(`  ${B}Open the dashboard:${X}`)
  console.log(`    ${D}http://127.0.0.1:5173/#dashboard${X}`)
  console.log()
  hr()
  console.log()
}

void main().catch((err) => {
  console.error()
  console.error(
    `  ${R}Error: ${err instanceof Error ? err.message : String(err)}${X}`,
  )
  console.error()
  exit(1)
})
