import type {
  PortfolioReader,
  WalletPortfolioSnapshot,
} from './types.js'

const DEFAULT_CACHE_TTL_MS = 10_000

type CacheEntry = {
  expiresAt: number
  snapshot?: WalletPortfolioSnapshot
  inFlight?: Promise<WalletPortfolioSnapshot>
}

export class CachedPortfolioReader implements PortfolioReader {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(
    private readonly inner: PortfolioReader,
    config: {
      ttlMs?: number
      now?: () => number
    } = {},
  ) {
    this.ttlMs = config.ttlMs ?? DEFAULT_CACHE_TTL_MS
    this.now = config.now ?? (() => Date.now())
  }

  async getWalletSnapshot(
    address: string,
    options?: { chainId?: string },
  ): Promise<WalletPortfolioSnapshot> {
    const key = `${options?.chainId ?? ''}:${address.trim()}`
    const at = this.now()
    const cached = this.cache.get(key)
    if (cached?.snapshot && cached.expiresAt > at) {
      return cached.snapshot
    }
    if (cached?.inFlight) {
      return cached.inFlight
    }

    const request = this.inner
      .getWalletSnapshot(address, options)
      .then((snapshot) => {
        this.cache.set(key, {
          snapshot,
          expiresAt: this.now() + this.ttlMs,
        })
        return snapshot
      })
      .catch((error) => {
        this.cache.delete(key)
        throw error
      })

    this.cache.set(key, {
      snapshot: cached?.snapshot,
      expiresAt: cached?.expiresAt ?? 0,
      inFlight: request,
    })
    return request
  }
}
