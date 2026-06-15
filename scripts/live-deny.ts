// LIVE GOVERNANCE PROOF — the "denied, recorded on-chain" money-shot. An over-limit swap (2.5 USDC,
// above the effective per-tx cap) is DENIED by policy BEFORE any Solana call, and the denial itself
// is recorded on the Mantle decision log (verdict=denied, outcome=blocked). No funds move; costs
// only test MNT gas. Pairs with live-swap.ts (the executed cross-chain record).
//
// Run with:  PALMOS_BASE_DIR=~/palmos-live node --import tsx scripts/live-deny.ts
process.env.PUSD_SOLANA_NETWORK = 'mainnet'
process.env.MANTLE_RECORD_LIVE = '1' // record the denial on Mantle for real (needs test MNT gas)

import { FileAgentRegistry } from '../src/store/AgentRegistry.js'
import { FileActionRequestRegistry } from '../src/store/ActionRequestRegistry.js'
import { OwsClient } from '../src/integrations/ows/client.js'
import { createByrealClient } from '../src/integrations/byreal/client.js'
import { requestAssetSwap } from '../src/app/requestAssetSwap.js'
import { createMantleRecorder } from '../src/integrations/mantle/deploymentStore.js'

const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const baseDir = process.env.PALMOS_BASE_DIR ?? '/tmp/palmos-live'

const agents = new FileAgentRegistry(baseDir)
const actions = new FileActionRequestRegistry(baseDir)
const ows = OwsClient.fromEnv(baseDir, { ...process.env, OWS_ENABLED: '1' })
const byreal = createByrealClient()

const all = await agents.list()
const agent = all.find((x) => x.walletId) ?? all[0]
if (!agent) throw new Error('no agent')
const walletName = agent.owsWalletName ?? agent.owsWalletId ?? agent.agentId

const recorder = await createMantleRecorder({ baseDir, ows: ows!, walletName, env: process.env })
if (!recorder) {
  console.error('❌ No Mantle recorder (deploy/mint first). Aborting.')
  process.exit(1)
}
if ((await recorder.getBalance()) === 0n) {
  console.error(`❌ Recorder has 0 test MNT — fund ${recorder.address}. Aborting.`)
  process.exit(1)
}

console.log(`Agent: ${agent.displayName} | submitting an OVER-LIMIT 2.5 USDC -> SOL swap (expect DENIED)…\n`)

const result = await requestAssetSwap(
  {
    agentRegistry: agents,
    actionRequests: actions,
    owsClient: ows,
    byrealClient: byreal,
    simulateSettlement: true, // never reached — denied before settlement
    mantleRecorder: recorder,
  },
  {
    agentId: agent.agentId,
    inputMint: USDC,
    outputMint: SOL,
    inputAssetSymbol: 'USDC',
    outputAssetSymbol: 'SOL',
    amount: '2.5', // exceeds effective per-tx cap -> policy denies
    slippageBps: 100,
    chainId: 'solana-mainnet',
    eligibleAgentStatuses: ['ready', 'approval_pending'],
    source: 'sdk',
  },
)

const ar = result.actionRequest
const ctx = (ar.requestContext ?? {}) as Record<string, unknown>
console.log(`Result   : ${result.kind} (${ar.status})`)
console.log(`Reason   : ${ar.errorCode ?? '(none)'}`)
console.log('— Mantle (ERC-8004 agent decision log) —')
console.log(`  verdict/outcome: ${ctx.mantleVerdict}/${ctx.mantleOutcome} | recorded=${ctx.mantleRecorded} simulated=${ctx.mantleSimulated}`)
if (ctx.mantleTxUrl) console.log('  Mantlescan:', ctx.mantleTxUrl)
console.log(
  '\nGovernance proof:',
  result.kind === 'blocked' && ctx.mantleTxHash
    ? '✅ out-of-policy swap DENIED and the denial is recorded on Mantle — no funds moved'
    : '⚠️ unexpected (check output)',
)
process.exit(result.kind === 'blocked' ? 0 : 1)
