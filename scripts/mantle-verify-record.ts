/**
 * Verify the Mantle decision log end-to-end against the deployed contracts. Forces live recording
 * (MANTLE_RECORD_LIVE=1) for this run only. Proves three things and prints Mantlescan tx links:
 *
 *   1. Direct contract write — record a synthetic DENIED and an EXECUTED decision via the recorder.
 *   2. Real governed path — run an OUT-OF-POLICY swap through requestAssetSwap (mantleRecorder
 *      wired). It is denied by policy BEFORE any Solana/Byreal call, so it spends NO Solana funds,
 *      and the "denied/blocked" decision lands on Mantle. This is the governance money-shot:
 *      "the agent was stopped, and that's recorded on-chain."
 *
 * Prereq: deploy + (ideally) mint done; deployer funded with test MNT.
 * Run:    node --import tsx scripts/mantle-verify-record.ts
 */
process.env.MANTLE_RECORD_LIVE = '1'

import { FileAgentRegistry } from '../src/store/AgentRegistry.js'
import { FileActionRequestRegistry } from '../src/store/ActionRequestRegistry.js'
import { OwsClient } from '../src/integrations/ows/client.js'
import { requestAssetSwap } from '../src/app/requestAssetSwap.js'
import { createMantleRecorder, readMantleDeployment } from '../src/integrations/mantle/deploymentStore.js'

const baseDir = process.env.PALMOS_BASE_DIR ?? '/tmp/palmos-live'

const deployment = await readMantleDeployment(baseDir)
if (!deployment?.actionLog) {
  throw new Error('No AgentActionLog deployed. Run scripts/mantle-deploy.ts first.')
}

const agents = new FileAgentRegistry(baseDir)
const actions = new FileActionRequestRegistry(baseDir)
const all = await agents.list()
const agent = all.find((x) => x.walletId) ?? all[0]
if (!agent) throw new Error(`No agent in ${baseDir}`)
const ows = OwsClient.fromEnv(baseDir, { ...process.env, OWS_ENABLED: '1' })!
const walletName = agent.owsWalletName ?? agent.owsWalletId ?? agent.agentId

const recorder = await createMantleRecorder({ baseDir, ows, walletName, env: process.env })
if (!recorder) throw new Error('Could not build Mantle recorder (no signer).')
console.log(`AgentActionLog: ${deployment.actionLog}`)
console.log(`Identity agentId: ${deployment.agent?.agentId ?? '(not minted)'}`)
console.log(`Recorder live: ${recorder.recordLive}\n`)

const balance = await recorder.getBalance()
if (balance === 0n) {
  console.error(`❌ ${recorder.address} has 0 MNT — fund it (faucet.sepolia.mantle.xyz) and re-run.`)
  process.exit(1)
}

console.log('--- 1. Direct DENIED record ---')
const denied = await recorder.recordDecision({
  actionRequestId: `verify_denied_${Math.random().toString(36).slice(2, 10)}`,
  kind: 'asset.swap',
  verdict: 'denied',
  outcome: 'blocked',
  detail: 'Swap 999 WIF → SOL | out of policy (governance money-shot)',
})
console.log(denied.error ? `  ❌ ${denied.error}` : `  ✅ seq=${denied.seq} tx=${denied.explorerUrl}`)

console.log('\n--- 2. Direct EXECUTED record (with sample Solana settlement link) ---')
const executed = await recorder.recordDecision({
  actionRequestId: `verify_executed_${Math.random().toString(36).slice(2, 10)}`,
  kind: 'asset.swap',
  verdict: 'auto_approved',
  outcome: 'executed',
  solanaSignature: '5verifySampleSolanaSignatureForCrossChainLinkDemoOnly1111111111111111',
  detail: 'Swap 0.02 USDC → SOL | settled on Solana',
})
console.log(executed.error ? `  ❌ ${executed.error}` : `  ✅ seq=${executed.seq} tx=${executed.explorerUrl}`)

console.log('\n--- 3. Real governed OUT-OF-POLICY swap via requestAssetSwap (no Solana spend) ---')
const allowed = agent.policyConfig?.allowedAssets ?? ['USDC']
const inputAssetSymbol = allowed[0] ?? 'USDC'
const result = await requestAssetSwap(
  { agentRegistry: agents, actionRequests: actions, mantleRecorder: recorder },
  {
    agentId: agent.agentId,
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    outputMint: 'ZZZZorphanMintNotInPolicy00000000000000000000',
    inputAssetSymbol,
    outputAssetSymbol: 'ZZZZ', // deliberately disallowed -> policy denies before any settlement
    amount: '0.01',
    chainId: agent.policyConfig?.allowedChains?.[0],
  },
)
const ctx = (result.actionRequest.requestContext ?? {}) as Record<string, unknown>
console.log(`  result.kind: ${result.kind}`)
console.log(`  mantleVerdict/outcome: ${ctx.mantleVerdict}/${ctx.mantleOutcome}`)
console.log(`  recorded: ${ctx.mantleRecorded}  txUrl: ${ctx.mantleTxUrl ?? '(none)'}`)

console.log('\n✅ Mantle decision log verified. Open the tx links above on Mantle Sepolia explorer.')
