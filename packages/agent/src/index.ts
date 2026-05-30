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
  settlementMode?: 'local-demo' | 'ows' | 'real-solana'
  walletId?: string
  walletState?: string
  walletBackend?: string
  owsWalletId?: string
  owsWalletName?: string
  privacyMode?: 'disabled' | 'allowed' | 'required'
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
  idempotencyKey?: string
  privacy?: 'default' | 'required'
}

export type PalmosSdkPolicyCheckInput = {
  serviceId: string
  amount?: string
}

export type PalmosSdkToolName =
  | 'list_services'
  | 'request_paid_service'
  | 'check_policy'
  | 'get_agent_status'

export type PalmosSdkToolDefinition = {
  name: PalmosSdkToolName
  description: string
  inputSchema: Record<string, unknown>
}

export type PalmosSdkPaidCallStatus =
  | 'blocked'
  | 'approval_pending'
  | 'waiting_for_execution'
  | 'executed'
  | 'failed'

export type PalmosSdkSettlement = {
  rail: string
  mode?: string
  source: string
  amount: string
  assetSymbol: string
  network?: string
  mint?: string
  payer?: string
  payerTokenAccount?: string
  recipient?: string
  recipientTokenAccount?: string
  reference?: string
  signature?: string
  explorerUrl?: string
  confirmationStatus: string
  confirmedAt?: string
  reconciliationStatus?: string
  reconciledAt?: string
  reconciliationError?: string
}

export type PalmosSdkPaidCallExecution = {
  executionId: string
  createdAt: string
  updatedAt: string
  agentId: string
  serviceId: string
  vendorId: string
  paymentRail: string
  settlementMode?: string
  amount: string
  assetSymbol: string
  chainId?: string
  transactionSignature?: string
  transactionExplorerUrl?: string
  settlement?: PalmosSdkSettlement
  status: PalmosSdkPaidCallStatus
  runId?: string
  sessionId?: string
  walletId?: string
  runtimeStatus?: string
  runtimePhase?: string
  requestSummary: Record<string, unknown>
  requestUrl?: string
  responseStatus?: number
  responsePreview?: unknown
  errorCode?: string
  errorMessage?: string
}

export type PalmosSdkPayResult =
  | {
      kind: 'blocked'
      agent: PalmosSdkAgent
      execution: PalmosSdkPaidCallExecution
      reason: string
    }
  | {
      kind: 'approval_pending'
      agent: PalmosSdkAgent
      execution: PalmosSdkPaidCallExecution
      turnOutput: string[]
    }
  | {
      kind: 'waiting_for_execution'
      agent: PalmosSdkAgent
      execution: PalmosSdkPaidCallExecution
      turnOutput: string[]
    }
  | {
      kind: 'executed'
      agent: PalmosSdkAgent
      execution: PalmosSdkPaidCallExecution
      turnOutput: string[]
    }
  | {
      kind: 'execution_failed'
      agent: PalmosSdkAgent
      execution: PalmosSdkPaidCallExecution
      turnOutput: string[]
      error: string
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

export type PalmosSdkAgentStatus = {
  agentId: string
  agentStatus: string
  credentialStatus: string
  trustTier: string
  settlementMode?: string
  walletState?: string
  lastCheckInAt?: string
}

export type PalmosSdkAgentStatusResponse = PalmosSdkMeResponse & {
  status: PalmosSdkAgentStatus
}

export type PalmosSdkPayResponse = {
  ok: true
  agentId: string
  credentialId: string
  idempotencyKey?: string
  idempotentReplay?: boolean
  result: PalmosSdkPayResult
}

export type PalmosSdkPolicyCheckResponse = {
  ok: true
  agentId: string
  serviceId: string
  vendorId: string
  amount: string
  allowed: boolean
  status: 'allowed' | 'restricted' | 'denied'
  requiresApproval: boolean
  reasonCode: string
  effectiveMaxPerTransaction: string
}

export type PalmosSdkToolsResponse = {
  ok: true
  agentId: string
  tools: PalmosSdkToolDefinition[]
}

export type PalmosSdkErrorResponse = {
  ok: false
  error: string
  message?: string
  requestId?: string
  details?: Record<string, unknown>
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

function readDefaultEnv(): Record<string, string | undefined> {
  const scope = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
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
  if (payload && typeof payload === 'object') {
    const message = (payload as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) {
      return message
    }

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

    this.baseUrl = trimTrailingSlash(config.baseUrl ?? 'https://api.getpalmos.xyz')
    this.token = config.token.trim()
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  static fromEnv(
    env: Record<string, string | undefined> = readDefaultEnv(),
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

  async listTools(): Promise<PalmosSdkToolsResponse> {
    return this.request<PalmosSdkToolsResponse>('/api/sdk/v1/tools')
  }

  async getAgentStatus(): Promise<PalmosSdkAgentStatusResponse> {
    return this.callTool<PalmosSdkAgentStatusResponse>('get_agent_status')
  }

  async checkPolicy(
    input: PalmosSdkPolicyCheckInput,
  ): Promise<PalmosSdkPolicyCheckResponse> {
    return this.callTool<PalmosSdkPolicyCheckResponse>('check_policy', input)
  }

  async requestPaidService(
    input: PalmosSdkPayInput,
  ): Promise<PalmosSdkPayResponse> {
    return this.callTool<PalmosSdkPayResponse>('request_paid_service', input)
  }

  async callTool<T>(
    toolName: PalmosSdkToolName,
    input: Record<string, unknown> = {},
  ): Promise<T> {
    const headers = new Headers()
    const idempotencyKey =
      typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : ''
    if (idempotencyKey) {
      headers.set('idempotency-key', idempotencyKey)
    }

    return this.request<T>(`/api/sdk/v1/tools/${toolName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input,
      }),
    })
  }

  async pay(input: PalmosSdkPayInput): Promise<PalmosSdkPayResponse> {
    const headers = new Headers()
    if (input.idempotencyKey?.trim()) {
      headers.set('idempotency-key', input.idempotencyKey.trim())
    }

    return this.request<PalmosSdkPayResponse>('/api/sdk/v1/pay', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        serviceId: input.serviceId,
        request: input.request ?? {},
        amount: input.amount,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
        privacy: input.privacy,
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
