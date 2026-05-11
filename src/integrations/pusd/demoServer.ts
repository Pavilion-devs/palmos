import express, { type Request, type Response, type NextFunction } from 'express'
import {
  createPusdPaymentRequest,
  isPusdPaymentRequestExpired,
  toPusdPaymentRequiredResponse,
  type PusdPaymentRequest,
} from './paymentInstructions.js'
import { verifyPusdPayment } from './verifier.js'
import {
  PALMOS_LOCAL_DEMO_MERCHANT_WALLET,
  readSolanaRpcUrlFromEnv,
} from './constants.js'

export type LocalPusdServerConfig = {
  port: number
  payToAddress: string
  spotPriceAmount: string
  opsBriefPriceAmount: string
  acceptLocalDemoPayments: boolean
  rpcUrl?: string
}

export type LocalPusdServer = {
  port: number
  payToAddress: string
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

function normalizeAmount(value: string | undefined, fallback: string): string {
  const normalized = value?.trim()
  return normalized && Number(normalized) > 0 ? normalized : fallback
}

function readHeader(req: Request, name: string): string | undefined {
  const value = req.header(name)
  return value?.trim() || undefined
}

function buildPaymentMiddleware(input: {
  requests: Map<string, PusdPaymentRequest>
  amount: string
  recipient: string
  serviceId: string
  vendorId: string
  description: string
  acceptLocalDemoPayments: boolean
  rpcUrl?: string
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const signature = readHeader(req, 'x-pusd-payment')
    const reference = readHeader(req, 'x-pusd-reference')
    const demoPayment = readHeader(req, 'x-palmos-demo-payment') === '1'

    if (signature && reference) {
      const paymentRequest = input.requests.get(reference)
      if (!paymentRequest) {
        res.status(402).json({
          ok: false,
          error: 'payment_reference_unknown',
        })
        return
      }
      if (isPusdPaymentRequestExpired(paymentRequest)) {
        paymentRequest.status = 'expired'
        paymentRequest.updatedAt = new Date().toISOString()
        res.status(402).json({
          ok: false,
          error: 'payment_reference_expired',
          reference,
        })
        return
      }
      if (!demoPayment) {
        const verification = await verifyPusdPayment({
          signature,
          request: paymentRequest,
          rpcUrl: input.rpcUrl,
        })
        if (!verification.valid) {
          res.status(402).json({
            ok: false,
            error: 'payment_verification_failed',
            reason: verification.reason,
            reference,
          })
          return
        }
      } else if (!input.acceptLocalDemoPayments) {
        res.status(402).json({
          ok: false,
          error: 'local_demo_payments_disabled',
          reference,
          message:
            'PalmOS local demo payments are disabled. Submit a real PUSD transaction signature.',
        })
        return
      }

      paymentRequest.status = 'paid'
      paymentRequest.updatedAt = new Date().toISOString()
      paymentRequest.transactionSignature = signature
      res.setHeader(
        'x-pusd-payment-response',
        Buffer.from(
          JSON.stringify({
            success: true,
            transaction: signature,
            reference,
            network: paymentRequest.network,
            demo: demoPayment,
          }),
        ).toString('base64'),
      )
      next()
      return
    }

    const paymentRequest = createPusdPaymentRequest({
      amount: input.amount,
      recipient: input.recipient,
      serviceId: input.serviceId,
      vendorId: input.vendorId,
      description: input.description,
    })
    input.requests.set(paymentRequest.reference, paymentRequest)
    res.status(402).json(toPusdPaymentRequiredResponse(paymentRequest))
  }
}

function buildSpotPrice(base: string, quote: string) {
  const normalizedBase = base.trim().toUpperCase() || 'SOL'
  const normalizedQuote = quote.trim().toUpperCase() || 'USD'
  const fixtures: Record<string, string> = {
    BTC: '64000.00',
    ETH: '3200.00',
    SOL: '150.00',
  }

  return {
    base: normalizedBase,
    quote: normalizedQuote,
    amount: fixtures[normalizedBase] ?? '1.00',
    provider: 'palmos_service_test_fixture',
    fetchedAt: new Date().toISOString(),
  }
}

export function readLocalPusdServerConfigFromEnv(
  env: Record<string, string | undefined> = readProcessEnv(),
): LocalPusdServerConfig {
  return {
    port: parsePort(env.PUSD_DEMO_SERVER_PORT, 4021),
    payToAddress:
      env.PUSD_MERCHANT_WALLET?.trim() ||
      PALMOS_LOCAL_DEMO_MERCHANT_WALLET,
    spotPriceAmount: normalizeAmount(env.PUSD_DEMO_SPOT_PRICE, '0.01'),
    opsBriefPriceAmount: normalizeAmount(env.PUSD_DEMO_OPS_BRIEF_PRICE, '0.25'),
    acceptLocalDemoPayments: env.PALMOS_ACCEPT_LOCAL_DEMO_PAYMENTS !== '0',
    rpcUrl: readSolanaRpcUrlFromEnv(env),
  }
}

export async function startLocalPusdDemoServer(
  config: LocalPusdServerConfig,
): Promise<LocalPusdServer> {
  const app = express()
  const requests = new Map<string, PusdPaymentRequest>()

  app.use(express.json())

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      rail: 'palmos-pusd',
      payToAddress: config.payToAddress,
      prices: {
        spotPrice: config.spotPriceAmount,
        opsBrief: config.opsBriefPriceAmount,
      },
      acceptLocalDemoPayments: config.acceptLocalDemoPayments,
    })
  })

  app.get(
    '/api/premium/spot-price',
    buildPaymentMiddleware({
      requests,
      amount: config.spotPriceAmount,
      recipient: config.payToAddress,
      serviceId: 'local.pusd.spot_price',
      vendorId: 'local_pusd_demo',
      description: 'PalmOS spot-price lookup protected by PUSD.',
      acceptLocalDemoPayments: config.acceptLocalDemoPayments,
      rpcUrl: config.rpcUrl,
    }),
    (req, res) => {
      const base = typeof req.query.base === 'string' ? req.query.base : 'SOL'
      const quote = typeof req.query.quote === 'string' ? req.query.quote : 'USD'
      res.json({
        ok: true,
        data: buildSpotPrice(base, quote),
      })
    },
  )

  app.get(
    '/api/premium/ops-brief',
    buildPaymentMiddleware({
      requests,
      amount: config.opsBriefPriceAmount,
      recipient: config.payToAddress,
      serviceId: 'local.pusd.ops_brief',
      vendorId: 'ops_research_vendor',
      description: 'PalmOS market-ops brief protected by PUSD.',
      acceptLocalDemoPayments: config.acceptLocalDemoPayments,
      rpcUrl: config.rpcUrl,
    }),
    (req, res) => {
      const symbols =
        typeof req.query.symbols === 'string'
          ? req.query.symbols
              .split(',')
              .map((value) => value.trim().toUpperCase())
              .filter(Boolean)
          : ['BTC', 'ETH', 'SOL']
      res.json({
        ok: true,
        data: {
          symbols,
          provider: 'palmos_service_test_fixture',
          summary:
            'Liquidity is concentrated in majors; agent should keep PUSD spend inside policy and request approval for larger paid calls.',
          signals: symbols.map((symbol) => ({
            symbol,
            spot: buildSpotPrice(symbol, 'USD').amount,
            bias: symbol === 'SOL' ? 'watch payments activity' : 'neutral',
          })),
          generatedAt: new Date().toISOString(),
        },
      })
    },
  )

  const server = await new Promise<import('http').Server>((resolve) => {
    const instance = app.listen(config.port, '127.0.0.1', () => resolve(instance))
  })

  return {
    port: config.port,
    payToAddress: config.payToAddress,
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
