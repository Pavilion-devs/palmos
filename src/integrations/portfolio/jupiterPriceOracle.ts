import type { PriceOracle } from './types.js'

// Jupiter Price API V3 — the live USD price source for Solana SPL mints (and SOL,
// via the wrapped-SOL mint). Prices are fetched live on every call; the only
// "cache" is a very short request-coalescing window (default 15s, env-tunable)
// whose sole job is to avoid hammering the API into rate-limit errors, which would
// otherwise DEGRADE liveness by turning a fetch into no-price-at-all. Nothing is
// persisted; prices are never stored beyond the in-memory coalescing window.
//
// Endpoint shape (verified June 2026):
//   GET https://lite-api.jup.ag/price/v3?ids=<mint1>,<mint2>   (keyless public host)
//   GET https://api.jup.ag/price/v3?ids=...    + header x-api-key  (keyed host)
// Response is a top-level object keyed by mint:
//   { "<mint>": { "usdPrice": number, "blockId": number, "decimals": number,
//                 "priceChange24h": number }, ... }
// Mints that cannot be priced are omitted from the response entirely.

const LITE_API_URL = 'https://lite-api.jup.ag/price/v3'
const KEYED_API_URL = 'https://api.jup.ag/price/v3'
const DEFAULT_CACHE_TTL_MS = 15_000
const DEFAULT_TIMEOUT_MS = 4_000
const MAX_IDS_PER_REQUEST = 50

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export type JupiterPriceOracleConfig = {
  baseUrl?: string
  apiKey?: string
  cacheTtlMs?: number
  timeoutMs?: number
  maxIdsPerRequest?: number
  fetchImpl?: FetchLike
  now?: () => number
}

type CacheEntry = { price: number; expiresAt: number }

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

export class JupiterPriceOracle implements PriceOracle {
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly cacheTtlMs: number
  private readonly timeoutMs: number
  private readonly maxIdsPerRequest: number
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private readonly cache = new Map<string, CacheEntry>()

  constructor(config: JupiterPriceOracleConfig = {}) {
    this.apiKey = config.apiKey
    this.baseUrl =
      config.baseUrl ?? (this.apiKey ? KEYED_API_URL : LITE_API_URL)
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxIdsPerRequest = config.maxIdsPerRequest ?? MAX_IDS_PER_REQUEST
    this.fetchImpl =
      config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
    this.now = config.now ?? (() => Date.now())
  }

  static fromEnv(
    env: Record<string, string | undefined> = process.env,
  ): JupiterPriceOracle | undefined {
    const source = (env.PALMOS_PRICE_SOURCE ?? 'jupiter').trim().toLowerCase()
    if (source === 'none' || source === 'off' || source === 'disabled') {
      return undefined
    }
    const cacheTtlMs = Number(env.PALMOS_PRICE_CACHE_TTL_MS)
    return new JupiterPriceOracle({
      baseUrl: env.JUPITER_PRICE_API_URL?.trim() || undefined,
      apiKey:
        env.JUPITER_PRICE_API_KEY?.trim() ||
        env.PALMOS_JUPITER_API_KEY?.trim() ||
        undefined,
      cacheTtlMs: Number.isFinite(cacheTtlMs) && cacheTtlMs >= 0
        ? cacheTtlMs
        : undefined,
    })
  }

  async getUsdPrices(mints: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>()
    const unique = [...new Set(mints.map((mint) => mint.trim()).filter(Boolean))]
    if (unique.length === 0) {
      return prices
    }

    const now = this.now()
    const stale: string[] = []
    for (const mint of unique) {
      const cached = this.cache.get(mint)
      if (cached && cached.expiresAt > now) {
        prices.set(mint, cached.price)
      } else {
        stale.push(mint)
      }
    }
    if (stale.length === 0) {
      return prices
    }

    // Live fetch for anything outside the coalescing window. Failures are
    // swallowed per-batch so one bad request never blanks the whole portfolio.
    for (const ids of chunk(stale, this.maxIdsPerRequest)) {
      const fetched = await this.fetchBatch(ids)
      const expiresAt = this.now() + this.cacheTtlMs
      for (const [mint, price] of fetched) {
        this.cache.set(mint, { price, expiresAt })
        prices.set(mint, price)
      }
    }
    return prices
  }

  private async fetchBatch(ids: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>()
    const url = `${this.baseUrl}?ids=${ids.join(',')}`
    const headers: Record<string, string> = { accept: 'application/json' }
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey
    }
    try {
      const response = await this.fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!response.ok) {
        return result
      }
      const body = (await response.json()) as Record<
        string,
        { usdPrice?: number } | null | undefined
      >
      if (!body || typeof body !== 'object') {
        return result
      }
      for (const mint of ids) {
        const usdPrice = body[mint]?.usdPrice
        if (typeof usdPrice === 'number' && Number.isFinite(usdPrice)) {
          result.set(mint, usdPrice)
        }
      }
    } catch {
      // Network error / timeout / bad JSON: omit these mints, never throw.
    }
    return result
  }
}
