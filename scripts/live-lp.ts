// LIVE CROSS-CHAIN LP — the last untested seam, end-to-end on real funds (tiny):
//   • Solana: a real governed Byreal CLMM position open (policy gate -> Byreal build w/ NFT-mint
//     co-signer -> OWS vault sign -> broadcast on mainnet) — a verifiable Solscan tx.
//   • Mantle: the decision + outcome (with the real Solana signature) recorded on the ERC-8004
//     agent's on-chain decision log — verifiable on Mantlescan.
// One agent, one OWS vault, two chains. Real funds (~0.05 USDC into the vetted SOL/USDC pool).
//
// Run with:  HELIUS_API_KEY=<key> PALMOS_BASE_DIR=~/palmos-live node --import tsx scripts/live-lp.ts
const HELIUS = process.env.HELIUS_API_KEY?.trim()
process.env.PUSD_SOLANA_NETWORK = 'mainnet'
const RPC =
  process.env.PUSD_SOLANA_RPC_URL ??
  (HELIUS ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS}` : 'https://api.mainnet-beta.solana.com')
process.env.PUSD_SOLANA_RPC_URL = RPC
process.env.SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? RPC
process.env.MANTLE_RECORD_LIVE = '1'

import { FileAgentRegistry } from '../src/store/AgentRegistry.js'
import { FileActionRequestRegistry } from '../src/store/ActionRequestRegistry.js'
import { OwsClient } from '../src/integrations/ows/client.js'
import { createByrealClient } from '../src/integrations/byreal/client.js'
import { requestLiquidityAction } from '../src/app/requestLiquidityAction.js'
import { createMantleRecorder } from '../src/integrations/mantle/deploymentStore.js'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const VETTED_POOL = '9GTj99g9tbz9U6UYDsX6YeRTgUnkYG6GTnHv3qLa5aXq'
const AMOUNT_USDC = '0.05' // under autoApproveUnder (0.1) → settles autonomously
const baseDir = process.env.PALMOS_BASE_DIR ?? '/Users/olathepavilion/palmos-live'

const agents = new FileAgentRegistry(baseDir)
const actions = new FileActionRequestRegistry(baseDir)
const ows = OwsClient.fromEnv(baseDir, { ...process.env, OWS_ENABLED: '1' })
const byreal = createByrealClient()

const all = await agents.list()
const agent = all.find((x) => x.walletId) ?? all[0]
if (!agent) throw new Error('no agent')
const walletName = agent.owsWalletName ?? agent.owsWalletId ?? agent.agentId

// Pre-flight the Mantle recorder so the decision actually lands on-chain. Abort BEFORE settling if
// it can't, so we never get a settled position with no matching Mantle record.
const recorder = await createMantleRecorder({ baseDir, ows: ows!, walletName, env: process.env })
if (!recorder) {
  console.error('❌ No Mantle recorder (deploy/mint first). Aborting.')
  process.exit(1)
}
const mnt = await recorder.getBalance()
console.log(`Mantle recorder: ${recorder.address} | live=${recorder.recordLive} | MNT=${mnt}`)
if (mnt === 0n) {
  console.error(`❌ Recorder has 0 test MNT — fund ${recorder.address}. Aborting.`)
  process.exit(1)
}

// Fresh price → a ±12% range around it.
const pools = await byreal.listPools({ sortField: 'tvl', sortType: 'desc', pageSize: 50 })
const pool = pools.find((p) => p.id === VETTED_POOL)
const price = Number(pool?.current_price)
if (!Number.isFinite(price)) throw new Error('could not read pool price')
const priceLower = (price * 0.88).toFixed(6)
const priceUpper = (price * 1.12).toFixed(6)

console.log(`\nAgent: ${agent.displayName} | Solana owner ${ows?.getSolanaAddress(walletName)}`)
console.log(`Opening LP: ${AMOUNT_USDC} USDC (auto-swap) into SOL/USDC @ ~${price}, range [${priceLower}, ${priceUpper}]…\n`)

const result = await requestLiquidityAction(
  {
    agentRegistry: agents,
    actionRequests: actions,
    owsClient: ows,
    byrealClient: byreal,
    simulateSettlement: false, // LIVE broadcast
    mantleRecorder: recorder,
  },
  {
    agentId: agent.agentId,
    op: 'open',
    pool: VETTED_POOL,
    priceLower,
    priceUpper,
    base: USDC,
    baseAssetSymbol: 'USDC',
    amount: AMOUNT_USDC,
    autoSwap: true,
    slippageBps: 100,
    chainId: 'solana-mainnet',
    eligibleAgentStatuses: ['ready', 'approval_pending'],
    source: 'sdk',
  },
)

const ar = result.actionRequest
const ctx = (ar.requestContext ?? {}) as Record<string, unknown>
const solSig = (ar.resultRef as string | undefined) ?? (ctx.settlementSignature as string | undefined)
const mantleTx = ctx.mantleTxHash as string | undefined
const mantleUrl = ctx.mantleTxUrl as string | undefined

console.log(`Result      : ${result.kind} (${ar.status})`)
if (result.kind === 'execution_failed') console.log('Error       :', result.error)

console.log('\n— Solana (Byreal CLMM position) —')
if (solSig) {
  console.log('  signature :', solSig)
  console.log('  Solscan   : https://solscan.io/tx/' + solSig)
}
console.log('— Mantle (ERC-8004 agent decision log) —')
console.log(`  verdict/outcome: ${ctx.mantleVerdict}/${ctx.mantleOutcome} | recorded=${ctx.mantleRecorded} simulated=${ctx.mantleSimulated}`)
if (mantleUrl) console.log('  Mantlescan:', mantleUrl)

console.log(
  '\nCross-chain link:',
  solSig && mantleTx
    ? `✅ Mantle record references Solana LP tx ${solSig.slice(0, 14)}… — both verifiable on-chain`
    : '⚠️ incomplete (check output above)',
)
process.exit(result.kind === 'executed' ? 0 : 1)
