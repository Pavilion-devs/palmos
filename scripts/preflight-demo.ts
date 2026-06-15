/**
 * Read-only pre-flight for the live demo. NO funds, NO signing — quotes + unsigned-tx builds only,
 * against Byreal's public mainnet API via byreal-cli. Answers the open questions:
 *   1. Which SOL/USDC pool(s) exist + current price/fee/TVL (for LP range selection).
 *   2. Do tiny swaps route AMM (not RFQ — RFQ can't be raw-broadcast)?
 *   3. What's the smallest viable CLMM position (does a sub-$1 LP open even build)?
 *
 * ownerPubkey is build-only (the tx is never signed/broadcast), so any valid pubkey works.
 * Run:  node --import tsx scripts/preflight-demo.ts
 */
import { createByrealClient } from '../src/integrations/byreal/client.js'

const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const OWNER = '4LermEmh8qcN5Kq8wk6ALFHT1PaKFDcLK3a1PcPk3XW6' // build-only; no key/funds needed

const byreal = createByrealClient()

console.log('=== 1. SOL/USDC pools (for LP range) ===')
const pools = await byreal.listPools({ sortField: 'tvl', sortType: 'desc', pageSize: 50 })
const solUsdc = pools.filter(
  (p) => /sol/i.test(p.pair) && /usdc/i.test(p.pair),
)
if (!solUsdc.length) {
  console.log('  ⚠️  no SOL/USDC pool found in top 50 by TVL — widening search needed')
}
for (const p of solUsdc.slice(0, 6)) {
  console.log(
    `  ${p.id}  ${p.pair}  price=${p.current_price}  tvl=$${p.tvl_usd}  fee=${p.fee_rate_bps}bps  apr=${p.total_apr ?? p.apr}`,
  )
}
const pool = solUsdc[0]
if (!pool) {
  console.log('No SOL/USDC pool — aborting LP checks.')
  process.exit(1)
}
const price = Number(pool.current_price)
console.log(`\n  → using pool ${pool.id} (${pool.pair}), price ≈ ${price}`)

console.log('\n=== 2. Tiny swaps — AMM vs RFQ routing ===')
for (const amt of ['0.01', '0.03', '0.05', '0.1']) {
  try {
    const q = await byreal.quoteSwap({ inputMint: USDC, outputMint: SOL, amount: amt, ownerPubkey: OWNER })
    const flag = q.routerType === 'AMM' ? '✅' : '⚠️ RFQ (cannot raw-broadcast)'
    console.log(`  ${amt} USDC → SOL: router=${q.routerType} ${flag}  out=${q.uiOutAmount} SOL  impact=${q.priceImpactPct}%`)
  } catch (e) {
    console.log(`  ${amt} USDC → SOL: ❌ ${(e as Error).message.slice(0, 180)}`)
  }
}

console.log('\n=== 3. Smallest viable CLMM position (open --unsigned-tx, build-only) ===')
// NOTE: --auto-swap (zap) requires --amount + --base (a pool MINT), NOT --amount-usd.
const lower = (price * 0.9).toFixed(6)
const upper = (price * 1.1).toFixed(6)
console.log(`  range [${lower}, ${upper}] (±10% around price), supplying USDC with auto-swap`)
for (const amt of ['0.5', '0.1', '0.05', '0.02', '0.01']) {
  try {
    const r = await byreal.buildPositionUnsigned({
      op: 'open',
      pool: pool.id,
      priceLower: lower,
      priceUpper: upper,
      amount: amt, // UI amount of `base`
      base: USDC, // supply from USDC; auto-swap zaps the SOL side
      autoSwap: true,
      slippageBps: 100,
      ownerPubkey: OWNER,
    })
    console.log(`  ${amt} USDC: ✅ built ${r.unsignedTransactions.length} tx(s)${r.extraSignerPublicKey ? ' (+NFT-mint co-signer)' : ''}`)
  } catch (e) {
    console.log(`  ${amt} USDC: ❌ ${(e as Error).message.slice(0, 200)}`)
  }
}

console.log('\nPre-flight done. (Builds are unsigned; nothing was signed or broadcast.)')
