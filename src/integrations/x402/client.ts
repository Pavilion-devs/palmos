import { wrapFetchWithPayment } from 'x402-fetch'
import { createWalletClient, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import type { X402ServiceDefinition } from './serviceCatalog.js'

export type X402BuyerChain = 'base' | 'baseSepolia'

export type X402BuyerConfig = {
  privateKey: `0x${string}`
  rpcUrl?: string
  chain: X402BuyerChain
  maxPaymentAmount: string
}

export type X402ExecutionResult = {
  status: number
  headers: Record<string, string>
  body: unknown
}

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

function parseUsdcAmountToBaseUnits(amount: string): bigint {
  const normalized = amount.trim()
  if (!normalized) {
    throw new Error('USDC amount cannot be empty.')
  }

  const [wholePart = '', fractionalPart = ''] = normalized.split('.')
  const whole = wholePart === '' ? '0' : wholePart
  const fraction = `${fractionalPart}000000`.slice(0, 6)

  if (!/^\d+$/.test(whole) || !/^\d{0,6}$/.test(fractionalPart)) {
    throw new Error(`Invalid USDC amount: ${amount}`)
  }

  return BigInt(whole) * 1_000_000n + BigInt(fraction || '0')
}

function resolveBuyerChain(chain: X402BuyerChain) {
  return chain === 'baseSepolia' ? baseSepolia : base
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return response.text()
}

function collectHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries())
}

export function readX402BuyerConfigFromEnv(
  env: Record<string, string | undefined> = readProcessEnv(),
): X402BuyerConfig | undefined {
  const privateKey = env.X402_BUYER_PRIVATE_KEY
  if (!privateKey?.startsWith('0x')) {
    return undefined
  }

  const rawChain = env.X402_BUYER_CHAIN?.trim()
  const chain: X402BuyerChain =
    rawChain === 'baseSepolia' ? 'baseSepolia' : 'base'

  return {
    privateKey: privateKey as `0x${string}`,
    rpcUrl: env.X402_BUYER_RPC_URL,
    chain,
    maxPaymentAmount: env.X402_MAX_USDC_PER_CALL?.trim() || '0.05',
  }
}

export function ensureLocalDemoX402BuyerConfig(
  preferredChain: X402BuyerChain,
  env: Record<string, string | undefined> = readProcessEnv(),
): {
  config: X402BuyerConfig
  generated: boolean
} {
  const configured = readX402BuyerConfigFromEnv(env)
  if (configured) {
    return {
      config: configured,
      generated: false,
    }
  }

  env.X402_BUYER_PRIVATE_KEY = generatePrivateKey()
  env.X402_BUYER_CHAIN = preferredChain
  env.X402_MAX_USDC_PER_CALL = env.X402_MAX_USDC_PER_CALL?.trim() || '0.05'

  const generated = readX402BuyerConfigFromEnv(env)
  if (!generated) {
    throw new Error('Unable to provision a local x402 demo buyer wallet.')
  }

  return {
    config: generated,
    generated: true,
  }
}

export function createX402PaidFetch(
  config: X402BuyerConfig,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const account = privateKeyToAccount(config.privateKey)
  const walletClient = createWalletClient({
    account,
    chain: resolveBuyerChain(config.chain),
    transport: http(config.rpcUrl),
  })

  return wrapFetchWithPayment(
    fetchImpl as typeof globalThis.fetch,
    walletClient as never,
    parseUsdcAmountToBaseUnits(config.maxPaymentAmount),
  ) as typeof fetch
}

export class X402Client {
  private readonly fetchWithPayment: typeof fetch

  constructor(fetchWithPayment: typeof fetch) {
    this.fetchWithPayment = fetchWithPayment
  }

  static fromBuyerConfig(config: X402BuyerConfig): X402Client {
    return new X402Client(createX402PaidFetch(config))
  }

  static fromEnv(
    env?: Record<string, string | undefined>,
  ): X402Client | undefined {
    const config = readX402BuyerConfigFromEnv(env)
    return config ? X402Client.fromBuyerConfig(config) : undefined
  }

  async execute<TRequest>(
    service: X402ServiceDefinition<TRequest>,
    request: TRequest,
  ): Promise<X402ExecutionResult> {
    const preparedRequest = service.buildRequest(request)
    const response = await this.fetchWithPayment(
      preparedRequest.url,
      preparedRequest.init,
    )
    const body = await parseResponseBody(response)

    return {
      status: response.status,
      headers: collectHeaders(response.headers),
      body,
    }
  }
}
