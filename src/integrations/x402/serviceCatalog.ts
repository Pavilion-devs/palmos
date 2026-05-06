import { readLocalDemoExpectedAmountFromEnv } from './price.js'

export type X402ServiceRequestSpec = {
  url: string
  init?: RequestInit
  requestSummary: Record<string, unknown>
}

export type X402ServiceDefinition<TRequest = unknown> = {
  serviceId: string
  label: string
  paymentRail: 'x402'
  vendorId: string
  chainId: string
  assetSymbol: 'USDC'
  expectedAmount: string
  buildRequest(input: TRequest): X402ServiceRequestSpec
}

export type CoinGeckoSimplePriceRequest = {
  ids?: string[]
  symbols?: string[]
  vsCurrencies: string[]
  includeMarketCap?: boolean
  include24hrVol?: boolean
  include24hrChange?: boolean
  includeLastUpdatedAt?: boolean
  precision?: string
}

export type LocalSpotPriceRequest = {
  baseSymbol?: string
  quoteSymbol?: string
  base?: string
  quote?: string
  symbol?: string
  pair?: string
  market?: string
  request?: {
    baseSymbol?: string
    quoteSymbol?: string
    base?: string
    quote?: string
    symbol?: string
    pair?: string
    market?: string
  }
}

export type LocalOpsBriefRequest = {
  symbols?: string[]
  focus?: string
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function setBooleanParam(
  url: URL,
  key: string,
  value: boolean | undefined,
): void {
  if (typeof value === 'boolean') {
    url.searchParams.set(key, value ? 'true' : 'false')
  }
}

function normalizeSymbol(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

function parsePairValue(value: string | undefined): {
  baseSymbol?: string
  quoteSymbol?: string
} {
  const raw = normalizeSymbol(value)
  if (!raw) {
    return {}
  }

  const delimited = raw.match(/^([A-Z0-9]{2,10})[\/:_-]([A-Z0-9]{2,10})$/)
  if (delimited) {
    return {
      baseSymbol: delimited[1],
      quoteSymbol: delimited[2],
    }
  }

  const fused = raw.match(/^([A-Z]{2,10})(USD|USDC|USDT|EUR|BTC|ETH)$/)
  if (fused) {
    return {
      baseSymbol: fused[1],
      quoteSymbol: fused[2],
    }
  }

  return {}
}

function resolvePairCandidates(
  ...values: Array<string | undefined>
): { baseSymbol?: string; quoteSymbol?: string } {
  for (const value of values) {
    const parsed = parsePairValue(value)
    if (parsed.baseSymbol && parsed.quoteSymbol) {
      return parsed
    }
  }

  return {}
}

export function createCoinGeckoSimplePriceService(input?: {
  baseUrl?: string
  expectedAmount?: string
}): X402ServiceDefinition<CoinGeckoSimplePriceRequest> {
  const baseUrl = trimTrailingSlash(
    input?.baseUrl ?? 'https://pro-api.coingecko.com',
  )

  return {
    serviceId: 'coingecko.simple_price',
    label: 'CoinGecko x402 Simple Price',
    paymentRail: 'x402',
    vendorId: 'coingecko_x402',
    chainId: 'base',
    assetSymbol: 'USDC',
    expectedAmount: input?.expectedAmount ?? '0.01',
    buildRequest(request) {
      const symbols = request.symbols?.filter(Boolean) ?? []
      const ids = request.ids?.filter(Boolean) ?? []
      const vsCurrencies = request.vsCurrencies?.filter(Boolean) ?? []

      if (symbols.length === 0 && ids.length === 0) {
        throw new Error(
          'CoinGecko simple price requests must include at least one symbol or id.',
        )
      }

      if (vsCurrencies.length === 0) {
        throw new Error(
          'CoinGecko simple price requests must include at least one quote currency.',
        )
      }

      const url = new URL(`${baseUrl}/api/v3/x402/simple/price`)

      if (symbols.length > 0) {
        url.searchParams.set('symbols', symbols.join(','))
      }

      if (ids.length > 0) {
        url.searchParams.set('ids', ids.join(','))
      }

      url.searchParams.set('vs_currencies', vsCurrencies.join(','))
      setBooleanParam(url, 'include_market_cap', request.includeMarketCap)
      setBooleanParam(url, 'include_24hr_vol', request.include24hrVol)
      setBooleanParam(url, 'include_24hr_change', request.include24hrChange)
      setBooleanParam(
        url,
        'include_last_updated_at',
        request.includeLastUpdatedAt,
      )

      if (request.precision) {
        url.searchParams.set('precision', request.precision)
      }

      return {
        url: url.toString(),
        init: {
          method: 'GET',
        },
        requestSummary: {
          ids,
          symbols,
          vsCurrencies,
          includeMarketCap: request.includeMarketCap ?? false,
          include24hrVol: request.include24hrVol ?? false,
          include24hrChange: request.include24hrChange ?? false,
          includeLastUpdatedAt: request.includeLastUpdatedAt ?? false,
          precision: request.precision,
        },
      }
    },
  }
}

export function createLocalSpotPriceService(input?: {
  baseUrl?: string
  expectedAmount?: string
}): X402ServiceDefinition<LocalSpotPriceRequest> {
  const baseUrl = trimTrailingSlash(
    input?.baseUrl ?? 'http://127.0.0.1:4021',
  )

  return {
    serviceId: 'local.demo.spot_price',
    label: 'Local x402 Demo Spot Price',
    paymentRail: 'x402',
    vendorId: 'local_x402_demo',
    chainId: 'base-sepolia',
    assetSymbol: 'USDC',
    expectedAmount: input?.expectedAmount ?? '0.01',
    buildRequest(request) {
      const nested = request.request ?? {}
      const pair = resolvePairCandidates(
        request.pair,
        request.market,
        request.symbol,
        nested.pair,
        nested.market,
        nested.symbol,
      )
      const baseSymbol =
        normalizeSymbol(request.baseSymbol) ||
        normalizeSymbol(request.base) ||
        normalizeSymbol(nested.baseSymbol) ||
        normalizeSymbol(nested.base) ||
        pair.baseSymbol ||
        ''
      const quoteSymbol =
        normalizeSymbol(request.quoteSymbol) ||
        normalizeSymbol(request.quote) ||
        normalizeSymbol(nested.quoteSymbol) ||
        normalizeSymbol(nested.quote) ||
        pair.quoteSymbol ||
        ''

      if (!baseSymbol || !quoteSymbol) {
        throw new Error(
          'Local spot price requests must include both base and quote symbols.',
        )
      }

      const url = new URL(`${baseUrl}/api/premium/spot-price`)
      url.searchParams.set('base', baseSymbol)
      url.searchParams.set('quote', quoteSymbol)

      return {
        url: url.toString(),
        init: {
          method: 'GET',
        },
        requestSummary: {
          baseSymbol,
          quoteSymbol,
        },
      }
    },
  }
}

export function createLocalOpsBriefService(input?: {
  baseUrl?: string
  expectedAmount?: string
}): X402ServiceDefinition<LocalOpsBriefRequest> {
  const baseUrl = trimTrailingSlash(input?.baseUrl ?? 'http://127.0.0.1:4021')

  return {
    serviceId: 'local.demo.ops_brief',
    label: 'Local x402 Demo Ops Brief',
    paymentRail: 'x402',
    vendorId: 'ops_research_vendor',
    chainId: 'base-sepolia',
    assetSymbol: 'USDC',
    expectedAmount: input?.expectedAmount ?? '0.25',
    buildRequest(request) {
      const normalizedSymbols =
        request.symbols
          ?.map((value) => value.trim().toUpperCase())
          .filter(Boolean) ?? ['BTC', 'ETH', 'SOL']
      const url = new URL(`${baseUrl}/api/premium/ops-brief`)
      url.searchParams.set('symbols', normalizedSymbols.join(','))
      if (request.focus?.trim()) {
        url.searchParams.set('focus', request.focus.trim())
      }

      return {
        url: url.toString(),
        init: {
          method: 'GET',
        },
        requestSummary: {
          symbols: normalizedSymbols,
          focus: request.focus?.trim(),
        },
      }
    },
  }
}

export type X402ServiceCatalog = Record<string, X402ServiceDefinition<unknown>>

export function createDefaultX402ServiceCatalog(input?: {
  coingeckoBaseUrl?: string
  localDemoBaseUrl?: string
  localDemoExpectedAmount?: string
  localDemoSpotPriceAmount?: string
  localDemoOpsBriefAmount?: string
  env?: Record<string, string | undefined>
}): X402ServiceCatalog {
  const localDemoSpotPriceAmount =
    input?.localDemoSpotPriceAmount ??
    input?.localDemoExpectedAmount ??
    readLocalDemoExpectedAmountFromEnv(input?.env)
  const localDemoOpsBriefAmount =
    input?.localDemoOpsBriefAmount ?? '0.25'

  return {
    'coingecko.simple_price': createCoinGeckoSimplePriceService({
      baseUrl: input?.coingeckoBaseUrl,
    }) as X402ServiceDefinition<unknown>,
    'local.demo.spot_price': createLocalSpotPriceService({
      baseUrl: input?.localDemoBaseUrl,
      expectedAmount: localDemoSpotPriceAmount,
    }) as X402ServiceDefinition<unknown>,
    'local.demo.ops_brief': createLocalOpsBriefService({
      baseUrl: input?.localDemoBaseUrl,
      expectedAmount: localDemoOpsBriefAmount,
    }) as X402ServiceDefinition<unknown>,
  }
}
