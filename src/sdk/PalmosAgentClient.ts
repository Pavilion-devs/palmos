export type PalmosAgentClientConfig = {
  baseUrl?: string
  token: string
  fetchImpl?: typeof fetch
}

export type PalmosSdkCredential = {
  credentialId: string
  agentId: string
  label: string
  keyPrefix: string
  status: string
  createdAt?: string
  updatedAt?: string
  lastUsedAt?: string
}

export type PalmosSdkAgent = {
  agentId: string
  displayName: string
  organizationId: string
  treasuryId?: string
  environment: string
  status: string
  walletType: string
  walletId?: string
  walletState?: string
  walletBackend?: string
  owsWalletId?: string
  owsWalletName?: string
  policyConfig?: unknown
}

export type PalmosSdkService = {
  serviceId: string
  label: string
  vendorId: string
  chainId: string
  assetSymbol: string
  expectedAmount: string
  paymentRail: string
  allowed: boolean
}

export type PalmosSdkPayInput = {
  serviceId: string
  request?: Record<string, unknown>
  amount?: string
  note?: string
}

export type PalmosSdkMeResponse = {
  ok: true
  agent: PalmosSdkAgent
  credential: PalmosSdkCredential
}

export type PalmosSdkServicesResponse = {
  ok: true
  agentId: string
  services: PalmosSdkService[]
}

export type PalmosSdkPayResponse = {
  ok: true
  agentId: string
  credentialId: string
  result: unknown
}

export class PalmosAgentClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message)
    this.name = 'PalmosAgentClientError'
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error
    if (typeof error === 'string' && error.trim()) {
      return error
    }
  }

  return fallback
}

export class PalmosAgentClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(config: PalmosAgentClientConfig) {
    if (!config.token.trim()) {
      throw new Error('PalmOS agent token is required.')
    }

    this.baseUrl = trimTrailingSlash(config.baseUrl ?? 'http://127.0.0.1:4030')
    this.token = config.token.trim()
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  static fromEnv(
    env: Record<string, string | undefined> = process.env,
  ): PalmosAgentClient {
    const token = env.PALMOS_AGENT_TOKEN?.trim()
    if (!token) {
      throw new Error('Set PALMOS_AGENT_TOKEN to an issued palmos_... SDK token.')
    }

    return new PalmosAgentClient({
      baseUrl: env.PALMOS_API_URL?.trim(),
      token,
    })
  }

  async me(): Promise<PalmosSdkMeResponse> {
    return this.request<PalmosSdkMeResponse>('/api/sdk/v1/me')
  }

  async listServices(): Promise<PalmosSdkServicesResponse> {
    return this.request<PalmosSdkServicesResponse>('/api/sdk/v1/services')
  }

  async pay(input: PalmosSdkPayInput): Promise<PalmosSdkPayResponse> {
    return this.request<PalmosSdkPayResponse>('/api/sdk/v1/pay', {
      method: 'POST',
      body: JSON.stringify({
        serviceId: input.serviceId,
        request: input.request ?? {},
        amount: input.amount,
        note: input.note,
      }),
    })
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${this.token}`)
    headers.set('content-type', headers.get('content-type') ?? 'application/json')

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    })
    const payload = await parseJsonResponse(response)

    if (!response.ok) {
      throw new PalmosAgentClientError(
        readErrorMessage(payload, `PalmOS SDK request failed with ${response.status}.`),
        response.status,
        payload,
      )
    }

    return payload as T
  }
}
