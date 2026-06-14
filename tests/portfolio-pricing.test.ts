import assert from 'node:assert/strict'
import test from 'node:test'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { JupiterPriceOracle } from '../src/integrations/portfolio/jupiterPriceOracle.js'
import { CachedPortfolioReader } from '../src/integrations/portfolio/cachedPortfolioReader.js'
import { SolanaPortfolioReader } from '../src/integrations/portfolio/solanaPortfolioReader.js'
import type {
  PortfolioReader,
  PriceOracle,
  WalletPortfolioSnapshot,
} from '../src/integrations/portfolio/types.js'

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
  classicTokens?: Array<{ mint: string; uiAmount: number; address?: string }>
  token2022Tokens?: Array<{ mint: string; uiAmount: number; address?: string }>
  signaturesByAddress?: Record<
    string,
    Array<{ signature: string; blockTime?: number | null }>
  >
  parsedTransactions?: unknown[]
}) {
  // The reader fetches recent txns per-signature (getParsedTransaction), not as a batch, to stay
  // compatible with free-tier RPCs (batch getParsedTransactions is 403'd by e.g. Helius free).
  // Map each collected signature to its index-aligned parsed tx fixture.
  const flatSignatures = Object.values(input.signaturesByAddress ?? {}).flat()
  const sigToParsed = new Map<string, unknown>()
  ;(input.parsedTransactions ?? []).forEach((parsed, index) => {
    const sig = flatSignatures[index]?.signature
    if (sig) sigToParsed.set(sig, parsed)
  })
  return {
    async getBalance() {
      return input.lamports
    },
    async getParsedTokenAccountsByOwner(
      _owner: PublicKey,
      filter: { programId: PublicKey },
    ) {
      const tokens =
        filter.programId.toBase58() === TOKEN_PROGRAM_ID.toBase58()
          ? input.classicTokens ?? []
          : input.token2022Tokens ?? []
      return {
        value: tokens.map((token, index) => ({
          pubkey:
            token.address ??
            new PublicKey(new Uint8Array(32).fill(index + 1)).toBase58(),
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
    async getSignaturesForAddress(address: PublicKey) {
      return input.signaturesByAddress?.[address.toBase58()] ?? []
    },
    async getParsedTransactions() {
      return input.parsedTransactions ?? []
    },
    async getParsedTransaction(signature: string) {
      return sigToParsed.get(signature) ?? null
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
        [NATIVE_MINT.toBase58(), 150],
        [OTHER_MINT, 2.5],
        // UNPRICED_MINT intentionally absent.
      ])
    },
  }
  const reader = new SolanaPortfolioReader(
    { rpcUrl: 'http://localhost', chainId: 'solana-mainnet', pusdMint: PUSD_MINT },
    stubConnection({
      lamports: 2 * LAMPORTS_PER_SOL,
      classicTokens: [
        { mint: OTHER_MINT, uiAmount: 4 },
        { mint: UNPRICED_MINT, uiAmount: 7 },
      ],
      token2022Tokens: [{ mint: PUSD_MINT, uiAmount: 10 }],
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
      classicTokens: [{ mint: OTHER_MINT, uiAmount: 4 }],
    }) as never,
  )

  const snapshot = await reader.getWalletSnapshot(SOL_MINT)
  assert.equal(snapshot.positions.find((p) => p.symbol === 'SOL')?.value, undefined)
  assert.equal(snapshot.valuationComplete, false)
})

test('SolanaPortfolioReader never fails a snapshot when the oracle throws', async () => {
  const reader = new SolanaPortfolioReader(
    { rpcUrl: 'http://localhost', chainId: 'solana-mainnet', pusdMint: PUSD_MINT },
    stubConnection({
      lamports: LAMPORTS_PER_SOL,
      classicTokens: [{ mint: OTHER_MINT, uiAmount: 4 }],
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
  assert.equal(snapshot.valuationComplete, false)
})

test('SolanaPortfolioReader classifies inbound token-account credits as live deposit transactions', async () => {
  const owner = SOL_MINT
  const usdcTokenAccount = 'BhQmDvtviUWSoWNmhNrCePgAb1gpwrFRV9QxXw8SthyN'
  const reader = new SolanaPortfolioReader(
    { rpcUrl: 'http://localhost', chainId: 'solana-devnet', pusdMint: PUSD_MINT },
    stubConnection({
      lamports: 2 * LAMPORTS_PER_SOL,
      classicTokens: [
        {
          mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          uiAmount: 20,
          address: usdcTokenAccount,
        },
      ],
      signaturesByAddress: {
        [owner]: [],
        [usdcTokenAccount]: [
          {
            signature: 'sig_usdc_credit',
            blockTime: 1_718_150_400,
          },
        ],
      },
      parsedTransactions: [
        {
          transaction: {
            message: {
              accountKeys: [usdcTokenAccount, owner],
            },
          },
          meta: {
            preBalances: [0, 2 * LAMPORTS_PER_SOL],
            postBalances: [0, 2 * LAMPORTS_PER_SOL],
            preTokenBalances: [
              {
                accountIndex: 0,
                uiTokenAmount: { uiAmount: 0 },
              },
            ],
            postTokenBalances: [
              {
                accountIndex: 0,
                uiTokenAmount: { uiAmount: 20 },
              },
            ],
          },
        },
      ],
    }) as never,
    {
      async getUsdPrices() {
        return new Map([[SOL_MINT, 150]])
      },
    },
  )

  const snapshot = await reader.getWalletSnapshot(owner)
  const deposit = snapshot.transactions[0]

  assert.equal(deposit?.operationType, 'deposit')
  assert.equal(deposit?.direction, 'in')
  assert.equal(deposit?.assetSymbol, 'USDC')
  assert.equal(deposit?.amount, 20)
})

test('SolanaPortfolioReader keeps balance sync usable when recent activity enrichment is rate-limited', async () => {
  const reader = new SolanaPortfolioReader(
    { rpcUrl: 'http://localhost', chainId: 'solana-devnet', pusdMint: PUSD_MINT },
    {
      async getBalance() {
        return LAMPORTS_PER_SOL
      },
      async getParsedTokenAccountsByOwner() {
        return { value: [] }
      },
      async getSignaturesForAddress() {
        throw new Error('Too many requests for a specific RPC call')
      },
      async getParsedTransactions() {
        return []
      },
    } as never,
    {
      async getUsdPrices() {
        return new Map([[NATIVE_MINT.toBase58(), 150]])
      },
    },
  )

  const snapshot = await reader.getWalletSnapshot(SOL_MINT)
  assert.equal(snapshot.sync.kind, 'synced')
  assert.match(snapshot.sync.message, /recent activity unavailable/i)
  assert.equal(snapshot.transactions.length, 0)
  assert.equal(snapshot.positions.find((p) => p.symbol === 'SOL')?.value, 150)
})

test('CachedPortfolioReader dedupes concurrent reads and reuses fresh snapshots within ttl', async () => {
  let nowMs = 1_000
  let calls = 0
  let release: (() => void) | undefined
  const snapshot: WalletPortfolioSnapshot = {
    address: 'AlphaWallet111',
    positions: [],
    transactions: [],
    valuationComplete: true,
    sync: { kind: 'synced', chainId: 'solana-devnet', message: 'Synced.' },
  }
  const reader: PortfolioReader = {
    async getWalletSnapshot() {
      calls += 1
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return snapshot
    },
  }
  const cached = new CachedPortfolioReader(reader, {
    ttlMs: 10_000,
    now: () => nowMs,
  })

  const pending = Promise.all([
    cached.getWalletSnapshot('AlphaWallet111', { chainId: 'solana-devnet' }),
    cached.getWalletSnapshot('AlphaWallet111', { chainId: 'solana-devnet' }),
  ])
  assert.equal(calls, 1)
  release?.()
  const [first, second] = await pending
  assert.equal(first, snapshot)
  assert.equal(second, snapshot)

  const cachedAgain = await cached.getWalletSnapshot('AlphaWallet111', {
    chainId: 'solana-devnet',
  })
  assert.equal(calls, 1)
  assert.equal(cachedAgain, snapshot)

  nowMs += 20_000
  const refreshed = cached.getWalletSnapshot('AlphaWallet111', {
    chainId: 'solana-devnet',
  })
  assert.equal(calls, 2)
  release?.()
  await refreshed
})
