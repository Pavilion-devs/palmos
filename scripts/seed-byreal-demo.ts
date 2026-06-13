/**
 * Seed representative Byreal governed actions into a live dashboard store so the C7/C8 UI can be
 * eyeballed: an executed swap + LP open (with on-chain signatures → Solscan links), a denied
 * out-of-policy swap, and an approval-pending swap. Demo data only (signatures are valid-format
 * placeholders, not real settlements).
 *
 *   PALMOS_BASE_DIR=/tmp/palmos-live node --import tsx scripts/seed-byreal-demo.ts
 */
import { randomBytes } from 'node:crypto'
import bs58 from 'bs58'
import { FileAgentRegistry } from '../src/store/AgentRegistry.js'
import { FileActionRequestRegistry, type ActionRequestRecord } from '../src/store/ActionRequestRegistry.js'

const baseDir = process.env.PALMOS_BASE_DIR ?? '/tmp/palmos-live'
const sig = () => bs58.encode(randomBytes(64)) // ~88-char base58, valid signature format
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

async function main() {
  const agents = new FileAgentRegistry(baseDir)
  const actions = new FileActionRequestRegistry(baseDir)
  const all = await agents.list()
  const agent = all.find((a) => a.walletId) ?? all[0]
  if (!agent) throw new Error(`No agent found in ${baseDir}`)
  console.log(`Seeding governed Byreal actions for agent "${agent.displayName}" (${agent.agentId})\n`)

  const base = (over: Partial<ActionRequestRecord> & Pick<ActionRequestRecord, 'actionRequestId' | 'kind' | 'status' | 'title' | 'summary'>): ActionRequestRecord => ({
    createdAt: over.updatedAt ?? minsAgo(5),
    updatedAt: over.updatedAt ?? minsAgo(5),
    agentId: agent.agentId,
    organizationId: agent.organizationId,
    treasuryId: agent.treasuryId,
    walletId: agent.walletId,
    source: 'sdk',
    target: { kind: 'wallet', walletId: agent.walletId ?? agent.agentId, chainId: 'solana' },
    requestPayload: {},
    requestContext: { nativeActionRequest: true, settlementVia: 'byreal' },
    policy: { approvalRequired: false },
    executionPlan: { connectorKind: 'direct', executionMode: 'ows' },
    runtimeRefs: { sessionId: agent.sessionId, intentIds: [] },
    ...over,
  })

  const swapSig = sig()
  const lpSig = sig()

  const records: ActionRequestRecord[] = [
    // 1. Executed swap — on-chain signature → Solscan link
    base({
      actionRequestId: 'demo_swap_executed',
      kind: 'asset.swap',
      status: 'executed',
      updatedAt: minsAgo(2),
      title: 'Swap 1 SOL → USDC',
      summary: 'Swap of 1 SOL to USDC on Byreal.',
      value: { assetSymbol: 'SOL', amount: '1', chainId: 'solana' },
      resultRef: swapSig,
      runtimeRefs: { sessionId: agent.sessionId, intentIds: [], broadcastRefs: [swapSig] },
      executionPlan: { connectorKind: 'direct', executionMode: 'ows', settlementAsset: 'SOL' },
      requestContext: {
        nativeActionRequest: true, settlementVia: 'byreal', settlementBackend: 'ows',
        settlementRouter: 'AMM', settlementSignature: swapSig, expectedOutAmount: '66.87', outputAssetSymbol: 'USDC',
      },
    }),
    // 2. Executed liquidity open — on-chain signature → Solscan link
    base({
      actionRequestId: 'demo_liquidity_open',
      kind: 'asset.liquidity',
      status: 'executed',
      updatedAt: minsAgo(4),
      title: 'Liquidity open 25 USDC',
      summary: 'Open Byreal LP position in SOL/USDC with 25 USDC.',
      value: { assetSymbol: 'USDC', amount: '25', chainId: 'solana' },
      resultRef: lpSig,
      runtimeRefs: { sessionId: agent.sessionId, intentIds: [], broadcastRefs: [lpSig] },
      executionPlan: { connectorKind: 'direct', executionMode: 'ows', settlementAsset: 'USDC' },
      requestContext: {
        nativeActionRequest: true, settlementVia: 'byreal', settlementBackend: 'ows',
        liquidityOp: 'open', settlementSignature: lpSig,
      },
    }),
    // 3. Denied out-of-policy swap — the guardrails money shot (no signature, blocked)
    base({
      actionRequestId: 'demo_swap_blocked',
      kind: 'asset.swap',
      status: 'blocked',
      updatedAt: minsAgo(1),
      title: 'Swap 500 SOL → USDC',
      summary: 'Swap of 500 SOL to USDC on Byreal.',
      value: { assetSymbol: 'SOL', amount: '500', chainId: 'solana' },
      errorCode: 'policy.swap_amount_exceeds_limit',
      errorMessage: 'Swap amount 500 SOL exceeds the effective limit of 100.00.',
      policy: {
        approvalRequired: false,
        limitsApplied: { reasonCode: 'policy.swap_amount_exceeds_limit', effectiveMaxSwapAmount: '100.00' },
      },
    }),
    // 4. Approval-pending swap — surfaces in the approvals queue
    base({
      actionRequestId: 'demo_swap_pending',
      kind: 'asset.swap',
      status: 'approval_pending',
      updatedAt: minsAgo(0),
      title: 'Swap 50 USDC → SOL',
      summary: 'Swap of 50 USDC to SOL on Byreal — awaiting operator approval.',
      value: { assetSymbol: 'USDC', amount: '50', chainId: 'solana' },
      policy: { approvalRequired: true, approvalReason: 'policy.swap_approval_required' },
    }),
  ]

  for (const r of records) {
    await actions.put(r)
    console.log(`  • ${r.status.padEnd(16)} ${r.kind.padEnd(16)} ${r.title}`)
  }
  console.log(`\nSeeded ${records.length} records into ${baseDir}. The dashboard polls every ~3s.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
