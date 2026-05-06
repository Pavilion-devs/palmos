import express from 'express'
import { paymentMiddleware } from 'x402-express'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  readLocalDemoOpsBriefAmountFromEnv,
  readLocalDemoSpotPriceAmountFromEnv,
} from './price.js'

export type LocalX402ServerConfig = {
  port: number
  payToAddress?: `0x${string}`
  network: 'base' | 'base-sepolia'
  spotPriceAmount: string
  opsBriefPriceAmount: string
}

export type LocalX402Server = {
  port: number
  payToAddress: `0x${string}`
  close(): Promise<void>
}

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function hasCoinGeckoApiKey(
  env: Record<string, string | undefined> = readProcessEnv(),
): boolean {
  return Boolean(
    env.COINGECKO_PRO_API_KEY?.trim() || env.COINGECKO_DEMO_API_KEY?.trim(),
  )
}

function resolveCoinGeckoRequestConfig(
  env: Record<string, string | undefined> = readProcessEnv(),
): {
  baseUrl: string
  provider: 'coingecko_pro' | 'coingecko_demo'
  headers?: Record<string, string>
} {
  const proApiKey = env.COINGECKO_PRO_API_KEY?.trim()
  if (proApiKey) {
    return {
      baseUrl: 'https://pro-api.coingecko.com/api/v3',
      provider: 'coingecko_pro',
      headers: {
        'x-cg-pro-api-key': proApiKey,
      },
    }
  }

  const demoApiKey = env.COINGECKO_DEMO_API_KEY?.trim()
  if (demoApiKey) {
    return {
      baseUrl: 'https://api.coingecko.com/api/v3',
      provider: 'coingecko_demo',
      headers: {
        'x-cg-demo-api-key': demoApiKey,
      },
    }
  }

  throw new Error(
    'CoinGecko API key is required to use the CoinGecko provider.',
  )
}

async function fetchCoinbaseSpotPrice(baseSymbol: string, quoteSymbol: string) {
  const response = await fetch(
    `https://api.coinbase.com/v2/prices/${baseSymbol}-${quoteSymbol}/spot`,
  )

  if (!response.ok) {
    throw new Error(
      `Coinbase spot price request failed with status ${response.status}.`,
    )
  }

  const body = (await response.json()) as {
    data?: {
      amount?: string
      currency?: string
      base?: string
    }
  }
  const amount = body.data?.amount

  if (!amount) {
    throw new Error('Coinbase did not return a spot price amount.')
  }

  return {
    base: baseSymbol,
    quote: quoteSymbol,
    amount,
    provider: 'coinbase_public',
    fetchedAt: new Date().toISOString(),
  }
}

async function fetchCoinbaseMarketSnapshot(symbols: string[]) {
  const snapshot = await Promise.all(
    symbols.map(async (symbol) => {
      const quote = 'USD'
      const spotPrice = await fetchCoinbaseSpotPrice(symbol, quote)
      return {
        symbol,
        quote,
        amount: spotPrice.amount,
      }
    }),
  )

  return {
    symbols,
    snapshot,
    provider: 'coinbase_public',
    fetchedAt: new Date().toISOString(),
  }
}

async function fetchSpotPrice(baseSymbol: string, quoteSymbol: string) {
  if (!hasCoinGeckoApiKey()) {
    return fetchCoinbaseSpotPrice(baseSymbol, quoteSymbol)
  }

  const coingeckoIds: Record<string, string> = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    SOL: 'solana',
  }
  const assetId = coingeckoIds[baseSymbol]

  if (!assetId) {
    throw new Error(
      `No live demo price mapping is configured for symbol ${baseSymbol}.`,
    )
  }

  const coingecko = resolveCoinGeckoRequestConfig()
  const response = await fetch(
    `${coingecko.baseUrl}/simple/price?ids=${assetId}&vs_currencies=${quoteSymbol.toLowerCase()}`,
    {
      headers: coingecko.headers,
    },
  )

  if (!response.ok) {
    throw new Error(
      `CoinGecko spot price request failed with status ${response.status}.`,
    )
  }

  const body = (await response.json()) as Record<
    string,
    Record<string, number | undefined> | undefined
  >
  const amount = body[assetId]?.[quoteSymbol.toLowerCase()]

  if (typeof amount !== 'number') {
    throw new Error('CoinGecko did not return a numeric spot price.')
  }

  return {
    base: baseSymbol,
    quote: quoteSymbol,
    amount: String(amount),
    provider: coingecko.provider,
    fetchedAt: new Date().toISOString(),
  }
}

async function fetchMarketSnapshot(symbols: string[]) {
  if (!hasCoinGeckoApiKey()) {
    return fetchCoinbaseMarketSnapshot(symbols)
  }

  const coingeckoIds: Record<string, string> = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    SOL: 'solana',
  }
  const symbolMap = new Map<string, string>()
  for (const symbol of symbols) {
    const assetId = coingeckoIds[symbol]
    if (!assetId) {
      throw new Error(`No live demo price mapping is configured for symbol ${symbol}.`)
    }
    symbolMap.set(symbol, assetId)
  }

  const coingecko = resolveCoinGeckoRequestConfig()
  const ids = [...symbolMap.values()].join(',')
  const response = await fetch(
    `${coingecko.baseUrl}/simple/price?ids=${ids}&vs_currencies=usd`,
    {
      headers: coingecko.headers,
    },
  )

  if (!response.ok) {
    throw new Error(
      `CoinGecko market snapshot request failed with status ${response.status}.`,
    )
  }

  const body = (await response.json()) as Record<
    string,
    Record<string, number | undefined> | undefined
  >

  const snapshot = symbols.map((symbol) => {
    const assetId = symbolMap.get(symbol)
    const amount = assetId ? body[assetId]?.usd : undefined
    if (typeof amount !== 'number') {
      throw new Error(`CoinGecko did not return a numeric USD price for ${symbol}.`)
    }

    return {
      symbol,
      quote: 'USD',
      amount: String(amount),
    }
  })

  return {
    symbols,
    snapshot,
    provider: coingecko.provider,
    fetchedAt: new Date().toISOString(),
  }
}

export function readLocalX402ServerConfigFromEnv(
  env: Record<string, string | undefined> = readProcessEnv(),
): LocalX402ServerConfig {
  return {
    port: parsePort(env.X402_DEMO_SERVER_PORT, 4021),
    payToAddress: env.X402_PAY_TO_ADDRESS?.startsWith('0x')
      ? (env.X402_PAY_TO_ADDRESS as `0x${string}`)
      : undefined,
    network:
      env.X402_DEMO_SERVER_NETWORK === 'base' ? 'base' : 'base-sepolia',
    spotPriceAmount: readLocalDemoSpotPriceAmountFromEnv(env),
    opsBriefPriceAmount: readLocalDemoOpsBriefAmountFromEnv(env),
  }
}

export async function startLocalX402DemoServer(
  config: LocalX402ServerConfig,
): Promise<LocalX402Server> {
  const app = express()
  const payToAddress =
    config.payToAddress ??
    privateKeyToAccount(generatePrivateKey()).address

  app.use(
    paymentMiddleware(payToAddress, {
      '/api/premium/spot-price': {
        price: config.spotPriceAmount,
        network: config.network,
        config: {
          description:
            'Live crypto spot-price lookup protected by a local x402 paywall.',
        },
      },
      '/api/premium/ops-brief': {
        price: config.opsBriefPriceAmount,
        network: config.network,
        config: {
          description:
            'Live market-ops briefing protected by a local x402 paywall.',
        },
      },
    }),
  )

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      network: config.network,
      payToAddress,
      prices: {
        spotPrice: config.spotPriceAmount,
        opsBrief: config.opsBriefPriceAmount,
      },
    })
  })

  app.get('/api/premium/spot-price', async (req, res) => {
    try {
      const baseSymbol =
        typeof req.query.base === 'string' && req.query.base.trim()
          ? req.query.base.trim().toUpperCase()
          : 'BTC'
      const quoteSymbol =
        typeof req.query.quote === 'string' && req.query.quote.trim()
          ? req.query.quote.trim().toUpperCase()
          : 'USD'

      const spotPrice = await fetchSpotPrice(baseSymbol, quoteSymbol)

      res.json({
        ok: true,
        data: spotPrice,
      })
    } catch (error) {
      res.status(502).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown spot-price provider error.',
      })
    }
  })

  app.get('/api/premium/ops-brief', async (req, res) => {
    try {
      const requestedSymbols =
        typeof req.query.symbols === 'string' && req.query.symbols.trim()
          ? req.query.symbols
              .split(',')
              .map((value) => value.trim().toUpperCase())
              .filter(Boolean)
          : ['BTC', 'ETH', 'SOL']

      const marketSnapshot = await fetchMarketSnapshot(requestedSymbols)

      res.json({
        ok: true,
        data: marketSnapshot,
      })
    } catch (error) {
      res.status(502).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown ops-brief provider error.',
      })
    }
  })

  const server = await new Promise<import('http').Server>((resolve) => {
    const instance = app.listen(config.port, '127.0.0.1', () => resolve(instance))
  })

  return {
    port: config.port,
    payToAddress,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}
