export type ZerionConfig = {
  apiKey: string
  baseUrl: string
  env?: 'testnet'
}

export type ZerionWalletSyncStatus =
  | {
      kind: 'synced'
      chainId?: string
      message: string
    }
  | {
      kind: 'empty'
      chainId?: string
      message: string
    }
  | {
      kind: 'unsupported_chain'
      chainId: string
      message: string
    }
  | {
      kind: 'request_failed'
      chainId?: string
      message: string
    }
  | {
      kind: 'missing_wallet_address'
      chainId?: string
      message: string
    }
  | {
      kind: 'disabled'
      chainId?: string
      message: string
    }

export type ZerionWalletSnapshot = {
  address: string
  positions: Array<{
    id?: string
    symbol?: string
    chainId?: string
    value?: number
    quantity?: number
  }>
  transactions: Array<{
    id?: string
    hash?: string
    chainId?: string
    operationType?: string
    minedAt?: string
    direction?: string
    value?: number
  }>
  sync: ZerionWalletSyncStatus
}

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

function createBasicAuthHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`
}

function readJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function buildSyncStatus(
  status: ZerionWalletSyncStatus,
): ZerionWalletSyncStatus {
  return status
}

export function readZerionConfigFromEnv(
  env: Record<string, string | undefined> = readProcessEnv(),
): ZerionConfig | undefined {
  const apiKey = env.ZERION_API_KEY?.trim()
  if (!apiKey) {
    return undefined
  }

  return {
    apiKey,
    baseUrl: env.ZERION_BASE_URL?.trim() || 'https://api.zerion.io',
    env: env.ZERION_ENV === 'testnet' ? 'testnet' : undefined,
  }
}

export class ZerionClient {
  private supportedChainIdsPromise?: Promise<Set<string>>

  constructor(
    private readonly config: ZerionConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static fromEnv(
    env: Record<string, string | undefined> = readProcessEnv(),
  ): ZerionClient | undefined {
    const config = readZerionConfigFromEnv(env)
    return config ? new ZerionClient(config) : undefined
  }

  private async listSupportedChainIds(): Promise<Set<string>> {
    if (!this.supportedChainIdsPromise) {
      this.supportedChainIdsPromise = this.requestJson('/v1/chains/')
        .then((payload) => {
          const records = Array.isArray(payload.data) ? payload.data : []
          return new Set(
            records
              .map((item) => readString(readJsonRecord(item).id))
              .filter((value): value is string => Boolean(value)),
          )
        })
        .catch((error) => {
          this.supportedChainIdsPromise = undefined
          throw error
        })
    }

    return this.supportedChainIdsPromise
  }

  async supportsChain(chainId: string): Promise<boolean> {
    return (await this.listSupportedChainIds()).has(chainId)
  }

  private async requestJson(path: string): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(
      `${this.config.baseUrl.replace(/\/$/, '')}${path}`,
      {
        headers: {
          Authorization: createBasicAuthHeader(this.config.apiKey),
          accept: 'application/json',
          ...(this.config.env ? { 'X-Env': this.config.env } : {}),
        },
      },
    )

    if (!response.ok) {
      throw new Error(`Zerion request failed with status ${response.status} for ${path}.`)
    }

    return readJsonRecord(await response.json())
  }

  async getWalletSnapshot(
    address: string,
    options?: {
      chainId?: string
    },
  ): Promise<ZerionWalletSnapshot> {
    const walletAddress = address.trim()
    const requestedChainId = options?.chainId?.trim() || undefined

    if (!walletAddress) {
      return {
        address: '',
        positions: [],
        transactions: [],
        sync: buildSyncStatus({
          kind: 'missing_wallet_address',
          chainId: requestedChainId,
          message: 'Wallet address unavailable for Zerion sync.',
        }),
      }
    }

    if (requestedChainId) {
      const supported = await this.supportsChain(requestedChainId).catch(
        () => undefined,
      )
      if (supported === false) {
        return {
          address: walletAddress,
          positions: [],
          transactions: [],
          sync: buildSyncStatus({
            kind: 'unsupported_chain',
            chainId: requestedChainId,
            message: `Unsupported on ${requestedChainId}.`,
          }),
        }
      }
    }

    try {
      const [positionsResponse, transactionsResponse] = await Promise.all([
        this.requestJson(`/v1/wallets/${walletAddress}/positions/`),
        this.requestJson(
          `/v1/wallets/${walletAddress}/transactions/?page[size]=10`,
        ),
      ])

      const positions = (
        Array.isArray(positionsResponse.data)
          ? positionsResponse.data.map((item) => {
              const record = readJsonRecord(item)
              const attributes = readJsonRecord(record.attributes)
              const fungibleInfo = readJsonRecord(attributes.fungible_info)
              const quantity = readJsonRecord(attributes.quantity)
              const value = readJsonRecord(attributes.value)
              const implementation = Array.isArray(attributes.implementations)
                ? readJsonRecord(attributes.implementations[0])
                : {}

              return {
                id: typeof record.id === 'string' ? record.id : undefined,
                symbol:
                  typeof fungibleInfo.symbol === 'string'
                    ? fungibleInfo.symbol
                    : undefined,
                chainId:
                  typeof implementation.chain_id === 'string'
                    ? implementation.chain_id
                    : undefined,
                value: toNumber(value.usd),
                quantity: toNumber(quantity.numeric),
              }
            })
          : []
      ).filter((position) =>
        requestedChainId ? position.chainId === requestedChainId : true,
      )

      const transactions = (
        Array.isArray(transactionsResponse.data)
          ? transactionsResponse.data.map((item) => {
              const record = readJsonRecord(item)
              const attributes = readJsonRecord(record.attributes)
              return {
                id: typeof record.id === 'string' ? record.id : undefined,
                hash:
                  typeof attributes.hash === 'string'
                    ? attributes.hash
                    : undefined,
                chainId:
                  typeof attributes.chain_id === 'string'
                    ? attributes.chain_id
                    : undefined,
                operationType:
                  typeof attributes.operation_type === 'string'
                    ? attributes.operation_type
                    : undefined,
                minedAt:
                  typeof attributes.mined_at === 'string'
                    ? attributes.mined_at
                    : undefined,
                direction:
                  typeof attributes.direction === 'string'
                    ? attributes.direction
                    : undefined,
                value: toNumber(readJsonRecord(attributes.value).usd),
              }
            })
          : []
      ).filter((transaction) =>
        requestedChainId ? transaction.chainId === requestedChainId : true,
      )

      const hasData = positions.length > 0 || transactions.length > 0

      return {
        address: walletAddress,
        positions,
        transactions,
        sync: hasData
          ? buildSyncStatus({
              kind: 'synced',
              chainId: requestedChainId,
              message: requestedChainId
                ? `Synced on ${requestedChainId}.`
                : 'Zerion sync completed.',
            })
          : buildSyncStatus({
              kind: 'empty',
              chainId: requestedChainId,
              message: requestedChainId
                ? `No Zerion data found on ${requestedChainId}.`
                : 'No Zerion data found.',
            }),
      }
    } catch (error) {
      return {
        address: walletAddress,
        positions: [],
        transactions: [],
        sync: buildSyncStatus({
          kind: 'request_failed',
          chainId: requestedChainId,
          message:
            error instanceof Error ? error.message : 'Zerion request failed.',
        }),
      }
    }
  }
}
