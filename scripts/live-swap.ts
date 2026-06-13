// LIVE tiny swap: 0.02 USDC -> SOL on Solana mainnet, through the full governed PalmOS flow
// (policy gate -> Byreal AMM build -> OWS vault sign -> broadcast). Real funds. Persists the
// action request to the live store so it surfaces on the dashboard.
// Run with:  HELIUS_API_KEY=<key> node --import tsx scripts/live-swap.ts
const HELIUS = process.env.HELIUS_API_KEY?.trim()
process.env.PUSD_SOLANA_NETWORK = 'mainnet'
process.env.PUSD_SOLANA_RPC_URL =
  process.env.PUSD_SOLANA_RPC_URL ??
  (HELIUS
    ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS}`
    : 'https://api.mainnet-beta.solana.com')

import { FileAgentRegistry } from '../src/store/AgentRegistry.js'
import { FileActionRequestRegistry } from '../src/store/ActionRequestRegistry.js'
import { OwsClient } from '../src/integrations/ows/client.js'
import { createByrealClient } from '../src/integrations/byreal/client.js'
import { requestAssetSwap } from '../src/app/requestAssetSwap.js'

const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const baseDir = '/tmp/palmos-live'

const agents = new FileAgentRegistry(baseDir)
const actions = new FileActionRequestRegistry(baseDir)
const ows = OwsClient.fromEnv(baseDir, { ...process.env, OWS_ENABLED: '1' })
const byreal = createByrealClient()

const all = await agents.list()
const agent = all.find((x) => x.walletId) ?? all[0]
if (!agent) throw new Error('no agent')
const walletName = agent.owsWalletName ?? agent.owsWalletId ?? agent.agentId
console.log(`Agent: ${agent.displayName} | owner ${ows?.getSolanaAddress(walletName)}`)
console.log('Swapping 0.02 USDC -> SOL (LIVE, mainnet)…\n')

const result = await requestAssetSwap(
  {
    agentRegistry: agents,
    actionRequests: actions,
    owsClient: ows,
    byrealClient: byreal,
    simulateSettlement: false,
  },
  {
    agentId: agent.agentId,
    inputMint: USDC,
    outputMint: SOL,
    inputAssetSymbol: 'USDC',
    outputAssetSymbol: 'SOL',
    amount: '0.02',
    slippageBps: 100,
    chainId: 'solana-mainnet',
    eligibleAgentStatuses: ['ready', 'approval_pending'],
    source: 'sdk',
  },
)

const ar = result.actionRequest
const ctx = ar.requestContext as Record<string, unknown> | undefined
const sig = ar.resultRef ?? (ctx?.settlementSignature as string | undefined)
console.log('Result kind :', result.kind)
console.log('Status      :', ar.status)
console.log('Action id   :', ar.actionRequestId)
if (result.kind === 'execution_failed') console.log('Error       :', result.error)
if (ctx?.expectedOutAmount) console.log('Expected out:', ctx.expectedOutAmount, 'SOL')
if (sig) {
  console.log('Signature   :', sig)
  console.log('Solscan     : https://solscan.io/tx/' + sig)
}
process.exit(result.kind === 'executed' ? 0 : 1)
