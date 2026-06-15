// LIVE CROSS-CHAIN DEMO — the whole PalmOS thesis in one run:
//   • Solana: a real governed 0.02 USDC -> SOL swap (policy gate -> Byreal AMM build -> OWS vault
//     sign -> broadcast on mainnet) — a verifiable Solscan tx.
//   • Mantle: the decision + outcome (with the REAL Solana signature) recorded on the ERC-8004
//     agent's on-chain decision log — a verifiable Mantlescan tx that links back to the Solana tx.
// One agent, one vault (OWS), two chains. Real funds (tiny). Surfaces on the dashboard.
//
// Run with:  HELIUS_API_KEY=<key> node --import tsx scripts/live-swap.ts
const HELIUS = process.env.HELIUS_API_KEY?.trim()
process.env.PUSD_SOLANA_NETWORK = 'mainnet'
process.env.PUSD_SOLANA_RPC_URL =
  process.env.PUSD_SOLANA_RPC_URL ??
  (HELIUS
    ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS}`
    : 'https://api.mainnet-beta.solana.com')
process.env.MANTLE_RECORD_LIVE = '1' // record the decision on Mantle for real (needs test MNT gas)

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

// Pre-flight the Mantle recorder so the decision actually lands on-chain. If it can't (no test MNT),
// abort BEFORE the Solana swap so we never get a settled swap with no matching Mantle record.
const recorder = await createMantleRecorder({ baseDir, ows: ows!, walletName, env: process.env })
if (!recorder) {
  console.error('❌ No Mantle recorder (deploy/mint first via scripts/mantle-*). Aborting.')
  process.exit(1)
}
const mntBalance = await recorder.getBalance()
console.log(`Mantle recorder: ${recorder.address} | live=${recorder.recordLive} | MNT=${mntBalance}`)
if (mntBalance === 0n) {
  console.error(`❌ Recorder has 0 test MNT — fund ${recorder.address} at https://faucet.sepolia.mantle.xyz and re-run.`)
  process.exit(1)
}

console.log(`\nAgent: ${agent.displayName} | Solana owner ${ows?.getSolanaAddress(walletName)}`)
console.log('Cross-chain run: 0.05 USDC -> SOL on Solana (Byreal) + record decision on Mantle…\n')

const result = await requestAssetSwap(
  {
    agentRegistry: agents,
    actionRequests: actions,
    owsClient: ows,
    byrealClient: byreal,
    simulateSettlement: false,
    mantleRecorder: recorder,
  },
  {
    agentId: agent.agentId,
    inputMint: USDC,
    outputMint: SOL,
    inputAssetSymbol: 'USDC',
    outputAssetSymbol: 'SOL',
    amount: '0.05',
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
if (ctx.expectedOutAmount) console.log('Expected out:', ctx.expectedOutAmount, 'SOL')

console.log('\n— Solana (Byreal execution) —')
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
    ? `✅ Mantle record references Solana tx ${solSig.slice(0, 14)}… — both verifiable on-chain`
    : '⚠️ incomplete (check output above)',
)
process.exit(result.kind === 'executed' ? 0 : 1)
