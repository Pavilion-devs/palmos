import assert from 'node:assert/strict'
import test from 'node:test'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { NATIVE_MINT } from '@solana/spl-token'
import { JupiterPriceOracle } from '../src/integrations/portfolio/jupiterPriceOracle.js'
import { SolanaPortfolioReader } from '../src/integrations/portfolio/solanaPortfolioReader.js'
import type { PriceOracle } from '../src/integrations/portfolio/types.js'

const SOL_MINT = NATIVE_MINT.toBase58()
const OTHER_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
const UNPRICED_MINT = 'UnpRiced1111111111111111111111111111111111'

type StubBody = Record<string, { usdPrice?: number } | undefined>

function stubFetch(
  responder: (url: string) => { ok?: boolean; status?: number; body: unknown },
) {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    calls.push(url)
    const result = responder(url)
    return {
      ok: result.ok ?? true,
      status: result.status ?? 200,
      json: async () => result.body,
    }
  }
  return { fetchImpl, calls }
}

test('JupiterPriceOracle parses the keyed response and omits unpriced mints', async () => {
  const body: StubBody = {
    [SOL_MINT]: { usdPrice: 150.5 },
    [OTHER_MINT]: { usdPrice: 2.5 },
    // UNPRICED_MINT intentionally absent — the API omits unpriceable mints.
  }
  const { fetchImpl, calls } = stubFetch(() => ({ body }))
  const oracle = new JupiterPriceOracle({ fetchImpl })

  const prices = await oracle.getUsdPrices([SOL_MINT, OTHER_MINT, UNPRICED_MINT])

  assert.equal(prices.get(SOL_MINT), 150.5)
  assert.equal(prices.get(OTHER_MINT), 2.5)
  assert.equal(prices.has(UNPRICED_MINT), false)
  assert.equal(calls.length, 1)
  assert.ok(calls[0]?.includes('lite-api.jup.ag/price/v3'))
})

test('JupiterPriceOracle coalesces within the cache window and refetches once stale', async () => {
  let nowMs = 1_000
  const { fetchImpl, calls } = stubFetch(() => ({
    body: { [SOL_MINT]: { usdPrice: 100 } },
  }))
  const oracle = new JupiterPriceOracle({
    fetchImpl,
    cacheTtlMs: 15_000,
    now: () => nowMs,
  })

  await oracle.getUsdPrices([SOL_MINT])
  await oracle.getUsdPrices([SOL_MINT])
  assert.equal(calls.length, 1, 'second call within window must not refetch')

  nowMs += 20_000
  await oracle.getUsdPrices([SOL_MINT])
  assert.equal(calls.length, 2, 'expired entry must trigger a fresh live fetch')
})

test('JupiterPriceOracle batches into requests of at most maxIdsPerRequest', async () => {
  const { fetchImpl, calls } = stubFetch((url) => {
    const ids = (new URL(url).searchParams.get('ids') ?? '').split(',')
    const body: StubBody = {}
    for (const id of ids) {
      body[id] = { usdPrice: 1 }
    }
    return { body }
  })
  const oracle = new JupiterPriceOracle({ fetchImpl, maxIdsPerRequest: 2 })

  const prices = await oracle.getUsdPrices(['a', 'b', 'c'])

  assert.equal(calls.length, 2)
  assert.equal(prices.size, 3)
})

test('JupiterPriceOracle never throws on network failure or non-OK status', async () => {
  const throwing = new JupiterPriceOracle({
    fetchImpl: async () => {
      throw new Error('boom')
    },
  })
  assert.equal((await throwing.getUsdPrices([SOL_MINT])).size, 0)

  const rateLimited = new JupiterPriceOracle({
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }),
  })
  assert.equal((await rateLimited.getUsdPrices([SOL_MINT])).size, 0)
})

test('JupiterPriceOracle.fromEnv is on by default and disabled by PALMOS_PRICE_SOURCE=none', () => {
  assert.equal(JupiterPriceOracle.fromEnv({ PALMOS_PRICE_SOURCE: 'none' }), undefined)
  assert.ok(JupiterPriceOracle.fromEnv({}) instanceof JupiterPriceOracle)
})

function stubConnection(input: {
  lamports: number
  tokens: Array<{ mint: string; uiAmount: number }>
}) {
  return {
    async getBalance() {
      return input.lamports
    },
    async getParsedTokenAccountsByOwner() {
      return {
        value: input.tokens.map((token) => ({
          account: {
            data: {
              parsed: {
                info: {
                  mint: token.mint,
                  tokenAmount: { uiAmount: token.uiAmount },
                },
              },
            },
          },
        })),
      }
    },
    async getSignaturesForAddress() {
      return []
    },
  }
}

const PUSD_MINT = 'PusdMint1111111111111111111111111111111111'

test('SolanaPortfolioReader enriches SOL + non-stable SPL with live prices, pegs stables, leaves unpriced undefined', async () => {
  const oracle: PriceOracle = {
    async getUsdPrices(mints) {
      // PUSD must not be asked for — it keeps the $1 peg shortcut.
      assert.ok(!mints.includes(PUSD_MINT))
      return new Map<string, number>([
        [SOL_MINT, 150],
        [OTHER_MINT, 2.5],
        // UNPRICED_MINT intentionally absent.
      ])
    },
  }
  const reader = new SolanaPortfolioReader(
    { rpcUrl: 'http://localhost', chainId: 'solana-mainnet', pusdMint: PUSD_MINT },
    stubConnection({
      lamports: 2 * LAMPORTS_PER_SOL,
      tokens: [
        { mint: PUSD_MINT, uiAmount: 10 },
        { mint: OTHER_MINT, uiAmount: 4 },
        { mint: UNPRICED_MINT, uiAmount: 7 },
      ],
    }) as never,
    oracle,
  )

  const snapshot = await reader.getWalletSnapshot(SOL_MINT)
  const bySymbol = new Map(snapshot.positions.map((p) => [p.symbol, p]))

  assert.equal(bySymbol.get('SOL')?.value, 300) // 2 SOL * $150
  assert.equal(bySymbol.get('PUSD')?.value, 10) // stable peg, not oracle-priced
  assert.equal(bySymbol.get(OTHER_MINT.slice(0, 4) + '…' + OTHER_MINT.slice(-4))?.value, 10) // 4 * $2.5
  const unpriced = snapshot.positions.find((p) => p.id?.endsWith(UNPRICED_MINT))
  assert.equal(unpriced?.value, undefined)
})

test('SolanaPortfolioReader without an oracle leaves volatile values undefined', async () => {
  const reader = new SolanaPortfolioReader(
    { rpcUrl: 'http://localhost', chainId: 'solana-mainnet', pusdMint: PUSD_MINT },
    stubConnection({
      lamports: LAMPORTS_PER_SOL,
      tokens: [{ mint: OTHER_MINT, uiAmount: 4 }],
    }) as never,
  )

  const snapshot = await reader.getWalletSnapshot(SOL_MINT)
  assert.equal(snapshot.positions.find((p) => p.symbol === 'SOL')?.value, undefined)
})

test('SolanaPortfolioReader never fails a snapshot when the oracle throws', async () => {
  const reader = new SolanaPortfolioReader(
    { rpcUrl: 'http://localhost', chainId: 'solana-mainnet', pusdMint: PUSD_MINT },
    stubConnection({
      lamports: LAMPORTS_PER_SOL,
      tokens: [{ mint: OTHER_MINT, uiAmount: 4 }],
    }) as never,
    {
      async getUsdPrices() {
        throw new Error('oracle exploded')
      },
    },
  )

  const snapshot = await reader.getWalletSnapshot(SOL_MINT)
  assert.equal(snapshot.sync.kind, 'synced')
  assert.equal(snapshot.positions.find((p) => p.symbol === 'SOL')?.value, undefined)
})
