/**
 * Verify C1 (ByrealClient) against Byreal's live Solana mainnet API.
 *
 * Read-only methods are keyless; buildSwapUnsigned uses a throwaway pubkey and signs nothing
 * (it only fetches the unsigned tx the OWS vault will later sign in C2). No funds move.
 *
 * Run from the worktree:
 *   node --import tsx scripts/verify-byreal-client.ts
 */
import { Keypair, VersionedTransaction } from '@solana/web3.js'
import { createByrealClient } from '../src/integrations/byreal/client.js'

const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

async function main() {
  const byreal = createByrealClient()
  let failures = 0
  const ok = (label: string, cond: boolean, extra = '') => {
    console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`)
    if (!cond) failures++
  }

  // 1. listPools
  const pools = await byreal.listPools({ sortField: 'tvl', pageSize: 3 })
  ok('listPools', pools.length > 0, `${pools.length} pools`)
  for (const p of pools.slice(0, 3)) {
    console.log(
      `     ${p.pair.padEnd(14)} TVL $${Math.round(p.tvl_usd ?? 0).toLocaleString()}  APR ${((p.total_apr ?? 0) * 100).toFixed(2)}%  ${p.id}`,
    )
  }

  // 2. listTokens
  const tokens = await byreal.listTokens()
  ok('listTokens', tokens.length > 0, `${tokens.length} tokens — ${tokens.slice(0, 6).map((t) => t.symbol).join(', ')}`)

  // 3. quoteSwap (1 SOL -> USDC)
  const quote = await byreal.quoteSwap({ inputMint: SOL, outputMint: USDC, amount: '1', slippageBps: 100 })
  ok(
    'quoteSwap',
    Number(quote.uiOutAmount) > 0,
    `1 SOL -> ${quote.uiOutAmount} USDC | impact ${quote.priceImpactPct.toFixed(4)}% | router ${quote.routerType}`,
  )

  // 4. buildSwapUnsigned (throwaway owner, signs nothing) -> deserialize to prove it's a real v0 tx
  const owner = Keypair.generate().publicKey.toBase58()
  const built = await byreal.buildSwapUnsigned({
    inputMint: SOL,
    outputMint: USDC,
    amount: '0.01',
    slippageBps: 100,
    ownerPubkey: owner,
  })
  const raw = Buffer.from(built.unsignedTransactions[0], 'base64')
  const vtx = VersionedTransaction.deserialize(new Uint8Array(raw))
  ok(
    'buildSwapUnsigned',
    built.unsignedTransactions.length === 1 && vtx.message.version === 0,
    `v${vtx.message.version} tx, ${raw.length}b, requires ${vtx.message.header.numRequiredSignatures} sig(s), owner ${owner.slice(0, 8)}…`,
  )

  console.log(`\n${failures === 0 ? '✅ C1 ByrealClient: all checks passed' : `❌ ${failures} check(s) failed`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verify crashed:', e)
  process.exit(2)
})
