/**
 * Verify C4 — governed Byreal CLMM liquidity — end to end, offline.
 *
 * Uses the REAL ByrealClient + REAL OwsClient (throwaway vault), in-memory registries, and
 * simulateSettlement=true (OWS signs, never broadcasts; no funds move). Covers:
 *   1. C1 buildPositionUnsigned('open') against a live pool -> 2 signers, NFT mint pre-signed
 *   2. C2 signs the open tx -> owner sig valid, NFT mint sig preserved
 *   3. evaluateLiquidityRequest units (deposit gating + withdraw auto-approve)
 *   4. requestLiquidityAction orchestration (open auto-approve / over-limit / withdraw routing)
 *
 * Run from the worktree:  node --import tsx scripts/verify-c4-liquidity.ts
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PublicKey, VersionedTransaction } from '@solana/web3.js'
import nacl from 'tweetnacl'
import { OwsClient } from '../src/integrations/ows/client.js'
import { createByrealClient } from '../src/integrations/byreal/client.js'
import { evaluateLiquidityRequest } from '../src/policies/compileAgentPolicy.js'
import {
  requestLiquidityAction,
  type RequestLiquidityActionDependencies,
  type RequestLiquidityActionInput,
} from '../src/app/requestLiquidityAction.js'
import type { ActionRequestRecord } from '../src/store/ActionRequestRegistry.js'
import type { AgentRecord } from '../src/store/AgentRegistry.js'
import type { AgentPolicyTemplateInput } from '../src/policies/compileAgentPolicy.js'

async function main() {
  let failures = 0
  const ok = (label: string, cond: boolean, extra = '') => {
    console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`)
    if (!cond) failures++
  }

  const byreal = createByrealClient()
  const home = mkdtempSync(join(tmpdir(), 'palmos-c4-'))
  const ows = new OwsClient({ enabled: true, homeDir: home, vaultPath: join(home, '.ows'), passphrase: 'c4-verify' })
  const binding = await ows.ensureWallet({ name: 'c4' })
  const owner = binding.solanaAddress!

  // Pick a live pool to open a position in.
  const pools = await byreal.listPools({ sortField: 'tvl', pageSize: 10 })
  const pool = pools.find((p) => p.current_price && p.token_a?.mint && p.token_a?.symbol)
  if (!pool) throw new Error('No suitable pool found')
  const baseMint = pool.token_a.mint
  const baseSym = pool.token_a.symbol
  const price = pool.current_price!
  const priceLower = (price * 0.7).toPrecision(6)
  const priceUpper = (price * 1.3).toPrecision(6)
  console.log(`Pool ${pool.pair} (${pool.id}); base ${baseSym} @ ${price}; range [${priceLower}, ${priceUpper}]\n`)

  // 1. C1 — build an open position tx for the OWS owner
  const built = await byreal.buildPositionUnsigned({
    op: 'open',
    pool: pool.id,
    priceLower,
    priceUpper,
    base: baseMint,
    amount: '1',
    slippageBps: 150,
    ownerPubkey: owner,
  })
  const openTx = VersionedTransaction.deserialize(new Uint8Array(Buffer.from(built.unsignedTransactions[0], 'base64')))
  const ownerKey = new PublicKey(owner)
  const ownerIdx = openTx.message.staticAccountKeys.findIndex((k) => k.equals(ownerKey))
  const nRequired = openTx.message.header.numRequiredSignatures
  const nftSlotPreSigned = openTx.signatures.slice(0, nRequired).some((sig, i) => i !== ownerIdx && sig.some((b) => b !== 0))
  ok('C1 open builds a 2-signer tx with NFT mint pre-signed', nRequired === 2 && ownerIdx === 0 && nftSlotPreSigned, `${nRequired} signers, owner@${ownerIdx}`)

  // 2. C2 — OWS signs the open tx; owner sig valid, NFT mint sig preserved
  const res = await ows.signAndBroadcastSolanaTx({ wallet: 'c4', base64Tx: built.unsignedTransactions[0], skipBroadcast: true })
  const signed = VersionedTransaction.deserialize(new Uint8Array(Buffer.from(res.signedBase64, 'base64')))
  const ownerSig = signed.signatures[ownerIdx]
  const ownerValid = !!ownerSig && nacl.sign.detached.verify(signed.message.serialize(), ownerSig, ownerKey.toBytes())
  const nftStillSigned = signed.signatures.slice(0, nRequired).some((sig, i) => i !== ownerIdx && sig.some((b) => b !== 0))
  ok('C2 owner-signs the open tx; NFT mint sig preserved', ownerValid && nftStillSigned)

  // 3. Policy units
  const policy = {
    walletType: 'custodial',
    allowedAssets: [baseSym, 'USDC'],
    allowedChains: ['solana'],
    autoApproveUnder: '10',
    maxPerTransaction: '100',
    allowedVendors: [],
  } as unknown as AgentPolicyTemplateInput
  const ev = (op: 'open' | 'increase' | 'decrease' | 'close', sym?: string, amt?: string) =>
    evaluateLiquidityRequest({ policy, op, depositAssetSymbol: sym, depositAmount: amt, chainId: 'solana', trustTier: 'healthy' })
  ok('deposit under threshold -> auto-approved', ev('open', baseSym, '1').reasonCode === 'policy.liquidity_auto_approved')
  ok('deposit over threshold -> approval required', ev('open', baseSym, '50').requiresApproval === true)
  ok('deposit over limit -> denied', ev('open', baseSym, '200').reasonCode === 'policy.liquidity_amount_exceeds_limit')
  ok('disallowed deposit asset -> denied', ev('increase', 'BONK', '1').reasonCode === 'policy.liquidity_asset_not_allowed')
  ok('withdraw (close) -> auto-approved (no spend)', ev('close').reasonCode === 'policy.liquidity_auto_approved' && ev('close').requiresApproval === false)

  // 4. Orchestration
  const baseAgent = {
    agentId: 'agent_c4', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    displayName: 'C4 Agent', organizationId: 'org', environment: 'development', actorId: 'actor_c4',
    sessionId: 'session_c4', walletType: 'custodial', walletId: 'wallet_c4', walletBackend: 'ows',
    owsWalletName: 'c4', trustTier: 'healthy', status: 'ready', lastCheckInAt: new Date().toISOString(),
    policyConfig: policy,
  } as unknown as AgentRecord

  async function run(input: RequestLiquidityActionInput) {
    let agent: AgentRecord = { ...baseAgent }
    const stored: ActionRequestRecord[] = []
    const deps: RequestLiquidityActionDependencies = {
      agentRegistry: { get: async () => agent, put: async (a) => void (agent = a) },
      actionRequests: { put: async (r) => void stored.push(r) },
      byrealClient: byreal,
      owsClient: ows,
      simulateSettlement: true,
    }
    return { result: await requestLiquidityAction(deps, input), final: stored[stored.length - 1] }
  }

  const openInput: RequestLiquidityActionInput = {
    agentId: 'agent_c4', op: 'open', pool: pool.id, priceLower, priceUpper,
    base: baseMint, baseAssetSymbol: baseSym, amount: '1', slippageBps: 150,
  }

  {
    const { result, final } = await run(openInput)
    const ctx = final.requestContext as Record<string, unknown> | undefined
    ok('open auto-approved -> executed via Byreal+OWS', result.kind === 'executed' && ctx?.liquidityOp === 'open' && ctx?.settlementVia === 'byreal' && ctx?.settlementSimulated === true)
  }
  {
    const { result, final } = await run({ ...openInput, amount: '200' })
    ok('open over-limit -> blocked', result.kind === 'blocked' && final.errorCode === 'policy.liquidity_amount_exceeds_limit')
  }
  {
    // Withdraw with a non-existent position: policy auto-approves, settlement fails on build.
    // execution_failed (not blocked) proves the withdraw passed governance and attempted to settle.
    const { result } = await run({ agentId: 'agent_c4', op: 'close', nftMint: 'So11111111111111111111111111111111111111112' })
    ok('close (withdraw) passes policy, attempts settlement', result.kind === 'execution_failed')
  }

  console.log(`\n${failures === 0 ? '✅ C4 liquidity: build + sign + policy + orchestration all pass' : `❌ ${failures} check(s) failed`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verify crashed:', e)
  process.exit(2)
})
