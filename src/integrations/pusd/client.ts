import type {
  PalmosPaidServiceDefinition,
} from './serviceCatalog.js'
import type {
  PusdPaymentRequiredResponse,
} from './paymentInstructions.js'
import { readSolanaKeypairFromEnv, type ReadSolanaKeypairInput } from './keypair.js'
import { sendPusdPayment } from './transfer.js'
import { readSolanaRpcUrlFromEnv } from './constants.js'

export type PalmosExecutionResult = {
  status: number
  headers: Record<string, string>
  body: unknown
}

export type PalmosClientConfig = {
  demoPayer?: string
  allowLocalDemoPayments?: boolean
  rpcUrl?: string
  keypair?: ReadSolanaKeypairInput
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

function isPaymentRequiredPayload(
  body: unknown,
): body is PusdPaymentRequiredResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    body.error === 'payment_required' &&
    'reference' in body &&
    typeof body.reference === 'string'
  )
}

function createLocalDemoSignature(input: {
  reference: string
  amount: string
  recipient: string
}): string {
  const payload = [
    input.reference,
    input.amount,
    input.recipient,
    Date.now().toString(36),
  ].join(':')
  return `palmos_demo_${Buffer.from(payload).toString('base64url')}`
}

function mergeHeaders(
  initHeaders: HeadersInit | undefined,
  extra: Record<string, string>,
): Headers {
  const headers = new Headers(initHeaders)
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value)
  }
  return headers
}

export class PalmosClient {
  constructor(
    private readonly config: PalmosClientConfig = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static fromEnv(
    env: Record<string, string | undefined> = process.env,
  ): PalmosClient {
    return new PalmosClient({
      demoPayer: env.PUSD_AGENT_WALLET?.trim() || 'palmos-demo-agent',
      allowLocalDemoPayments: env.PALMOS_ALLOW_LOCAL_DEMO_PAYMENTS !== '0',
      rpcUrl: readSolanaRpcUrlFromEnv(env),
      keypair: {
        privateKey: env.PUSD_AGENT_PRIVATE_KEY,
        keypairPath: env.PUSD_AGENT_KEYPAIR_PATH,
      },
    })
  }

  async execute<TRequest>(
    service: PalmosPaidServiceDefinition<TRequest>,
    request: TRequest,
  ): Promise<PalmosExecutionResult> {
    const preparedRequest = service.buildRequest(request)
    const initialResponse = await this.fetchImpl(
      preparedRequest.url,
      preparedRequest.init,
    )
    const initialBody = await parseResponseBody(initialResponse)

    if (initialResponse.status !== 402 || !isPaymentRequiredPayload(initialBody)) {
      return {
        status: initialResponse.status,
        headers: collectHeaders(initialResponse.headers),
        body: initialBody,
      }
    }

    const signer = await readSolanaKeypairFromEnv({
      PUSD_AGENT_PRIVATE_KEY: this.config.keypair?.privateKey,
      PUSD_AGENT_KEYPAIR_PATH: this.config.keypair?.keypairPath,
    })
    let signature: string | undefined
    if (signer) {
      try {
        signature = await sendPusdPayment({
          payment: initialBody,
          payer: signer,
          rpcUrl: this.config.rpcUrl,
        })
      } catch (error) {
        if (this.config.allowLocalDemoPayments === false) {
          throw error
        }
      }
    }

    if (!signature && this.config.allowLocalDemoPayments === false) {
      return {
        status: initialResponse.status,
        headers: collectHeaders(initialResponse.headers),
        body: initialBody,
      }
    }

    const demoSignature =
      signature ??
      createLocalDemoSignature({
        reference: initialBody.reference,
        amount: initialBody.amount,
        recipient: initialBody.recipient,
      })
    const retryResponse = await this.fetchImpl(preparedRequest.url, {
      ...preparedRequest.init,
      headers: mergeHeaders(preparedRequest.init?.headers, {
        'x-pusd-payment': demoSignature,
        'x-pusd-reference': initialBody.reference,
        'x-palmos-demo-payment': signature ? '0' : '1',
        'x-palmos-demo-payer': this.config.demoPayer ?? 'palmos-demo-agent',
      }),
    })
    const retryBody = await parseResponseBody(retryResponse)

    return {
      status: retryResponse.status,
      headers: collectHeaders(retryResponse.headers),
      body: retryBody,
    }
  }
}
