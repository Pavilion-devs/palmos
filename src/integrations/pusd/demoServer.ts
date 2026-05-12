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
  onchainFlowAmount: string
  defiRiskAmount: string
  vendorBriefAmount: string
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

function buildOnchainFlowIntel(base: string, quote: string) {
  const normalizedBase = base.trim().toUpperCase() || 'SOL'
  const normalizedQuote = quote.trim().toUpperCase() || 'USD'
  const prices: Record<string, string> = {
    BTC: '64000.00',
    ETH: '3200.00',
    SOL: '150.00',
  }
  const flows: Record<string, { netFlow: string; whaleCount: number; bias: string }> = {
    BTC: { netFlow: '+$48.2M', whaleCount: 14, bias: 'accumulation' },
    ETH: { netFlow: '+$12.7M', whaleCount: 8, bias: 'neutral' },
    SOL: { netFlow: '+$31.5M', whaleCount: 21, bias: 'strong accumulation' },
  }
  const flow = flows[normalizedBase] ?? { netFlow: '+$1.2M', whaleCount: 3, bias: 'neutral' }

  return {
    asset: normalizedBase,
    quote: normalizedQuote,
    price: prices[normalizedBase] ?? '1.00',
    onchainFlow: {
      net24h: flow.netFlow,
      whaleWallets: flow.whaleCount,
      bias: flow.bias,
    },
    provider: 'palmos.intel',
    fetchedAt: new Date().toISOString(),
  }
}

function buildSpotPrice(base: string, quote: string) {
  const intel = buildOnchainFlowIntel(base, quote)
  return {
    base: intel.asset,
    quote: intel.quote,
    amount: intel.price,
    provider: intel.provider,
    fetchedAt: intel.fetchedAt,
  }
}

function buildDefiRiskReport(symbols: string[]) {
  return {
    protocol: symbols[0] ?? 'SOL',
    riskScore: 72,
    riskLevel: 'moderate',
    tvlTrend: '+18.4% (30d)',
    auditStatus: 'audited',
    smartContractExposure: 'low',
    liquidityDepth: symbols.map((symbol) => ({
      asset: symbol,
      price: buildSpotPrice(symbol, 'USD').amount,
      flow24h: buildOnchainFlowIntel(symbol, 'USD').onchainFlow.net24h,
    })),
    recommendation: 'Allocation within policy limits is supported. Large positions above session budget require operator approval before execution.',
    provider: 'palmos.research',
    generatedAt: new Date().toISOString(),
  }
}

function buildVendorBrief(vendor: string, service: string, focus: string) {
  return {
    vendor: vendor.trim() || 'PalmOS Data Vendor',
    service: service.trim() || 'Premium API access',
    focus: focus.trim() || 'payment readiness',
    status: 'eligible',
    settlementAsset: 'PUSD',
    controls: [
      'allowlist verified',
      'budget checked',
      'approval threshold evaluated',
    ],
    recommendation: 'Vendor payment is eligible under the configured PalmOS policy. Higher-value requests should remain approval-gated.',
    provider: 'palmos.ops',
    generatedAt: new Date().toISOString(),
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
    onchainFlowAmount: normalizeAmount(
      env.PUSD_DEMO_ONCHAIN_FLOW_PRICE ?? env.PUSD_DEMO_SPOT_PRICE,
      '0.02',
    ),
    defiRiskAmount: normalizeAmount(
      env.PUSD_DEMO_DEFI_RISK_PRICE ?? env.PUSD_DEMO_OPS_BRIEF_PRICE,
      '0.25',
    ),
    vendorBriefAmount: normalizeAmount(env.PUSD_DEMO_VENDOR_BRIEF_PRICE, '0.10'),
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
        onchainFlow: config.onchainFlowAmount,
        defiRisk: config.defiRiskAmount,
        vendorBrief: config.vendorBriefAmount,
      },
      acceptLocalDemoPayments: config.acceptLocalDemoPayments,
    })
  })

  app.get(
    '/api/premium/onchain-flow',
    buildPaymentMiddleware({
      requests,
      amount: config.onchainFlowAmount,
      recipient: config.payToAddress,
      serviceId: 'palmos.intel.onchain_flow',
      vendorId: 'palmos_intel_vendor',
      description: 'PalmOS on-chain flow intelligence protected by PUSD.',
      acceptLocalDemoPayments: config.acceptLocalDemoPayments,
      rpcUrl: config.rpcUrl,
    }),
    (req, res) => {
      const base = typeof req.query.base === 'string' ? req.query.base : 'SOL'
      const quote = typeof req.query.quote === 'string' ? req.query.quote : 'USD'
      res.json({
        ok: true,
        service: 'palmos.intel.onchain_flow',
        data: buildOnchainFlowIntel(base, quote),
      })
    },
  )

  app.get(
    '/api/premium/defi-risk',
    buildPaymentMiddleware({
      requests,
      amount: config.defiRiskAmount,
      recipient: config.payToAddress,
      serviceId: 'palmos.research.defi_risk',
      vendorId: 'palmos_research_vendor',
      description: 'PalmOS DeFi protocol risk report protected by PUSD.',
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
        service: 'palmos.research.defi_risk',
        data: buildDefiRiskReport(symbols),
      })
    },
  )

  app.get(
    '/api/premium/vendor-brief',
    buildPaymentMiddleware({
      requests,
      amount: config.vendorBriefAmount,
      recipient: config.payToAddress,
      serviceId: 'palmos.ops.vendor_brief',
      vendorId: 'palmos_ops_vendor',
      description: 'PalmOS vendor ops brief protected by PUSD.',
      acceptLocalDemoPayments: config.acceptLocalDemoPayments,
      rpcUrl: config.rpcUrl,
    }),
    (req, res) => {
      const vendor = typeof req.query.vendor === 'string' ? req.query.vendor : ''
      const service = typeof req.query.service === 'string' ? req.query.service : ''
      const focus = typeof req.query.focus === 'string' ? req.query.focus : ''
      res.json({
        ok: true,
        service: 'palmos.ops.vendor_brief',
        data: buildVendorBrief(vendor, service, focus),
      })
    },
  )

  app.get(
    '/api/premium/spot-price',
    buildPaymentMiddleware({
      requests,
      amount: config.onchainFlowAmount,
      recipient: config.payToAddress,
      serviceId: 'local.pusd.spot_price',
      vendorId: 'local_pusd_demo',
      description: 'PalmOS market-data compatibility endpoint protected by PUSD.',
      acceptLocalDemoPayments: config.acceptLocalDemoPayments,
      rpcUrl: config.rpcUrl,
    }),
    (req, res) => {
      const base = typeof req.query.base === 'string' ? req.query.base : 'SOL'
      const quote = typeof req.query.quote === 'string' ? req.query.quote : 'USD'
      res.json({
        ok: true,
        service: 'palmos.intel.onchain_flow',
        data: buildOnchainFlowIntel(base, quote),
      })
    },
  )

  app.get(
    '/api/premium/ops-brief',
    buildPaymentMiddleware({
      requests,
      amount: config.defiRiskAmount,
      recipient: config.payToAddress,
      serviceId: 'local.pusd.ops_brief',
      vendorId: 'ops_research_vendor',
      description: 'PalmOS research compatibility endpoint protected by PUSD.',
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
        service: 'palmos.research.defi_risk',
        data: buildDefiRiskReport(symbols),
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
