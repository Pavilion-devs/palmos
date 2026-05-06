import { mkdir } from 'fs/promises'
import { dirname } from 'path'
import { hexToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Lazy-load XMTP so entrypoints without XMTP config can still boot cleanly.
let _xmtpSdk: typeof import('@xmtp/node-sdk') | null = null
let _xmtpLoadFailed = false
let _xmtpLoadError: string | null = null

function describeRuntime(): string {
  const scope = globalThis as {
    Bun?: {
      version?: string
    }
    process?: {
      version?: string
    }
  }

  if (scope.Bun?.version) {
    return `Bun ${scope.Bun.version}`
  }

  if (scope.process?.version) {
    return `Node ${scope.process.version}`
  }

  return 'an unknown JavaScript runtime'
}

function describeHost(): string {
  const scope = globalThis as {
    process?: {
      platform?: string
      arch?: string
      report?: {
        getReport?: () => {
          header?: {
            glibcVersionRuntime?: string
          }
        }
      }
    }
  }

  const platform = scope.process?.platform ?? 'unknown-platform'
  const arch = scope.process?.arch ?? 'unknown-arch'
  const glibc =
    scope.process?.report?.getReport?.().header?.glibcVersionRuntime ?? 'n/a'

  return `${platform}/${arch} glibc:${glibc}`
}

function collectErrorChain(error: unknown): string[] {
  const messages: string[] = []
  let current: unknown = error

  while (current instanceof Error) {
    messages.push(current.message)
    current = current.cause
  }

  if (current != null) {
    messages.push(String(current))
  }

  return messages
}

function buildXmtpLoadError(error: unknown): string {
  const errorChain = collectErrorChain(error)
  const runtime = describeRuntime()
  const host = describeHost()
  const runtimeHint = runtime.startsWith('Bun')
    ? 'XMTP approvals require @xmtp/node-sdk on Node 20+; switch this service to Node 22+ instead of Bun.'
    : 'XMTP approvals require @xmtp/node-sdk on a supported Node 20+ runtime.'

  return `${runtimeHint} Runtime: ${runtime}. Host: ${host}. Native load chain: ${errorChain.join(' <- ')}`
}

async function loadXmtpSdk() {
  if (_xmtpSdk) return _xmtpSdk
  if (_xmtpLoadFailed) {
    throw new Error(_xmtpLoadError ?? 'XMTP SDK not available')
  }

  try {
    _xmtpSdk = await import('@xmtp/node-sdk')
    return _xmtpSdk
  } catch (error) {
    _xmtpLoadFailed = true
    _xmtpLoadError = buildXmtpLoadError(error)
    console.warn('[XmtpNotifier]', _xmtpLoadError)
    throw new Error(_xmtpLoadError, {
      cause: error,
    })
  }
}

type XmtpEnv = 'dev' | 'production' | 'local'
type Identifier = { identifier: string; identifierKind: number }
type Signer = {
  type: 'EOA'
  getIdentifier(): Identifier
  signMessage(message: string): Promise<Uint8Array>
}
type XmtpConversation = {
  id: string
  sendText(message: string): Promise<string>
}
type XmtpClient = {
  canMessage(identifiers: Identifier[]): Promise<Map<string, boolean>>
  conversations: {
    createDm(inboxId: string): Promise<XmtpConversation>
    createDmWithIdentifier(identifier: Identifier): Promise<XmtpConversation>
  }
}
import type { AgentRecord } from '../../store/AgentRegistry.js'
import type { PaidCallRecord } from '../../store/PaidCallRegistry.js'
import type { AgentControlEventRecord } from '../../store/AgentControlEventRegistry.js'
import type {
  XMTPAlertRecord,
  XMTPAlertRegistry,
  XMTPAlertType,
} from '../../store/XMTPAlertRegistry.js'

export type XmtpRecipient = {
  inboxId?: string
  address?: string
}

export type XmtpNotifierConfig = {
  walletKey: `0x${string}`
  env: XmtpEnv
  managerInboxId?: string
  managerAddress?: string
  dbPath?: string | null
  dbEncryptionKey?: `0x${string}`
  appVersion?: string
}

type SendAlertResult = XMTPAlertRecord

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

function nowIso(): string {
  return new Date().toISOString()
}

function createAlertId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

function buildEthereumIdentifier(address: string): Identifier {
  return {
    identifier: address.toLowerCase(),
    identifierKind: 0, // IdentifierKind.Ethereum
  }
}

function createSigner(walletKey: `0x${string}`): Signer {
  const account = privateKeyToAccount(walletKey)

  return {
    type: 'EOA',
    getIdentifier() {
      return buildEthereumIdentifier(account.address)
    },
    async signMessage(message) {
      const signature = await account.signMessage({
        message,
      })
      return hexToBytes(signature)
    },
  }
}

function getSignerAddress(walletKey: `0x${string}`): string {
  return privateKeyToAccount(walletKey).address
}

async function canMessageRecipient(
  client: XmtpClient,
  address: string,
): Promise<boolean> {
  const results = await client.canMessage([buildEthereumIdentifier(address)])
  return results.get(address.toLowerCase()) === true
}

async function openConversation(
  client: XmtpClient,
  recipient: XmtpRecipient,
): Promise<{
  conversationId?: string
  sendMessage(message: string): Promise<string>
}> {
  if (recipient.inboxId) {
    const conversation = await client.conversations.createDm(recipient.inboxId)
    return {
      conversationId: conversation.id,
      sendMessage(message) {
        return conversation.sendText(message)
      },
    }
  }

  if (!recipient.address) {
    throw new Error('XMTP recipient is missing an address or inbox id.')
  }

  const conversation = await client.conversations.createDmWithIdentifier(
    buildEthereumIdentifier(recipient.address),
  )
  return {
    conversationId: conversation.id,
    sendMessage(message) {
      return conversation.sendText(message)
    },
  }
}

export function readXmtpNotifierConfigFromEnv(
  env: Record<string, string | undefined> = readProcessEnv(),
): XmtpNotifierConfig | undefined {
  const walletKey = env.XMTP_WALLET_KEY?.trim()
  if (!walletKey?.startsWith('0x')) {
    return undefined
  }

  return {
    walletKey: walletKey as `0x${string}`,
    env: (env.XMTP_ENV?.trim() as XmtpEnv | undefined) ?? 'dev',
    managerInboxId: env.XMTP_MANAGER_INBOX_ID?.trim(),
    managerAddress: env.XMTP_MANAGER_ADDRESS?.trim(),
    dbPath: env.XMTP_DB_PATH?.trim() || undefined,
    dbEncryptionKey: env.XMTP_DB_ENCRYPTION_KEY?.trim()?.startsWith('0x')
      ? (env.XMTP_DB_ENCRYPTION_KEY.trim() as `0x${string}`)
      : undefined,
    appVersion: env.XMTP_APP_VERSION?.trim() || 'palmos/0.1.0',
  }
}

function renderApprovalRequestedMessage(input: {
  agent: AgentRecord
  execution: PaidCallRecord
}): string {
  return [
    `PalmOS approval request`,
    `Agent: ${input.agent.displayName} (${input.agent.agentId})`,
    `Spend: ${input.execution.amount} ${input.execution.assetSymbol}`,
    `Service: ${input.execution.serviceId}`,
    `Vendor: ${input.execution.vendorId}`,
    `Run: ${input.execution.runId ?? 'n/a'}`,
    `Execution: ${input.execution.executionId}`,
    `Status: ${input.execution.runtimeStatus ?? input.execution.status}`,
  ].join('\n')
}

function renderApprovalResolvedMessage(input: {
  agent: AgentRecord
  execution: PaidCallRecord
  decision: 'approved' | 'rejected' | 'expired' | 'invalidated'
}): string {
  return [
    `PalmOS approval resolved`,
    `Agent: ${input.agent.displayName} (${input.agent.agentId})`,
    `Decision: ${input.decision}`,
    `Execution: ${input.execution.executionId}`,
    `Runtime: ${input.execution.runtimeStatus ?? input.execution.status}`,
    `Service: ${input.execution.serviceId}`,
    `Spend: ${input.execution.amount} ${input.execution.assetSymbol}`,
  ].join('\n')
}

function renderDeadManSwitchMessage(input: {
  agent: AgentRecord
  controlEvent: AgentControlEventRecord
}): string {
  return [
    `PalmOS dead-man's-switch alert`,
    `Agent: ${input.agent.displayName} (${input.agent.agentId})`,
    `Wallet: ${input.agent.walletId ?? 'n/a'}`,
    `Status: ${input.agent.status}`,
    `Summary: ${input.controlEvent.summary}`,
    `Stale by seconds: ${String(input.controlEvent.metadata?.staleBySeconds ?? 'n/a')}`,
  ].join('\n')
}

async function persistAlert(
  registry: XMTPAlertRegistry | undefined,
  record: XMTPAlertRecord,
): Promise<XMTPAlertRecord> {
  await registry?.put(record)
  return record
}

export class XmtpNotifier {
  private clientPromise?: Promise<XmtpClient>

  constructor(
    private readonly config: XmtpNotifierConfig,
    private readonly registry?: XMTPAlertRegistry,
    private readonly createId: (prefix: string) => string = createAlertId,
  ) {}

  static fromEnv(
    env: Record<string, string | undefined> = readProcessEnv(),
    registry?: XMTPAlertRegistry,
  ): XmtpNotifier | undefined {
    const config = readXmtpNotifierConfigFromEnv(env)
    return config ? new XmtpNotifier(config, registry) : undefined
  }

  async assertReady(): Promise<void> {
    await loadXmtpSdk()
  }

  private async getClient(): Promise<XmtpClient> {
    if (!this.clientPromise) {
      const sdk = await loadXmtpSdk()

      if (this.config.dbPath) {
        await mkdir(dirname(this.config.dbPath), { recursive: true })
      }

      this.clientPromise = sdk.Client.create(
        createSigner(this.config.walletKey) as never,
        {
          env: this.config.env,
          dbPath: this.config.dbPath,
          dbEncryptionKey: this.config.dbEncryptionKey,
          appVersion: this.config.appVersion,
        } as never,
      ) as Promise<XmtpClient>
    }

    return this.clientPromise
  }

  private getConfiguredRecipient(): XmtpRecipient | undefined {
    if (this.config.managerInboxId) {
      return {
        inboxId: this.config.managerInboxId,
      }
    }

    if (this.config.managerAddress) {
      return {
        address: this.config.managerAddress,
      }
    }

    return undefined
  }

  private async sendTextAlert(input: {
    type: XMTPAlertType
    message: string
    recipient?: XmtpRecipient
    agentId?: string
    runId?: string
    executionId?: string
    controlEventId?: string
  }): Promise<SendAlertResult> {
    const createdAt = nowIso()
    const recipient = input.recipient ?? this.getConfiguredRecipient()
    const alertId = this.createId('xmtp_alert')
    const preview = input.message.slice(0, 280)

    if (!recipient?.inboxId && !recipient?.address) {
      return persistAlert(this.registry, {
        alertId,
        createdAt,
        updatedAt: createdAt,
        type: input.type,
        status: 'skipped',
        agentId: input.agentId,
        runId: input.runId,
        executionId: input.executionId,
        controlEventId: input.controlEventId,
        messagePreview: preview,
        reason: 'No XMTP recipient is configured.',
      })
    }

    try {
      const client = await this.getClient()
      let conversationId: string | undefined
      let messageId: string | undefined

      if (recipient.address) {
        const address = recipient.address.toLowerCase()
        const signerAddress = getSignerAddress(this.config.walletKey).toLowerCase()
        const isSelfRecipient = address === signerAddress
        const canMessage = isSelfRecipient
          ? undefined
          : await canMessageRecipient(client, address)
        if (!isSelfRecipient && !canMessage) {
          return persistAlert(this.registry, {
            alertId,
            createdAt,
            updatedAt: nowIso(),
            type: input.type,
            status: 'skipped',
            agentId: input.agentId,
            runId: input.runId,
            executionId: input.executionId,
            controlEventId: input.controlEventId,
            recipientAddress: recipient.address,
            messagePreview: preview,
            reason: 'Recipient is not XMTP-enabled on the configured network.',
          })
        }
      }

      const conversation = await openConversation(client, recipient)
      conversationId = conversation.conversationId
      messageId = await conversation.sendMessage(input.message)

      return persistAlert(this.registry, {
        alertId,
        createdAt,
        updatedAt: nowIso(),
        type: input.type,
        status: 'sent',
        agentId: input.agentId,
        runId: input.runId,
        executionId: input.executionId,
        controlEventId: input.controlEventId,
        recipientInboxId: recipient.inboxId,
        recipientAddress: recipient.address,
        conversationId,
        messageId,
        messagePreview: preview,
      })
    } catch (error) {
      return persistAlert(this.registry, {
        alertId,
        createdAt,
        updatedAt: nowIso(),
        type: input.type,
        status: 'failed',
        agentId: input.agentId,
        runId: input.runId,
        executionId: input.executionId,
        controlEventId: input.controlEventId,
        recipientInboxId: recipient.inboxId,
        recipientAddress: recipient.address,
        messagePreview: preview,
        reason: error instanceof Error ? error.message : 'Unknown XMTP error.',
      })
    }
  }

  async sendApprovalRequested(input: {
    agent: AgentRecord
    execution: PaidCallRecord
  }): Promise<SendAlertResult> {
    return this.sendTextAlert({
      type: 'approval.requested',
      agentId: input.agent.agentId,
      runId: input.execution.runId,
      executionId: input.execution.executionId,
      message: renderApprovalRequestedMessage(input),
    })
  }

  async sendApprovalResolved(input: {
    agent: AgentRecord
    execution: PaidCallRecord
    decision: 'approved' | 'rejected' | 'expired' | 'invalidated'
  }): Promise<SendAlertResult> {
    return this.sendTextAlert({
      type: 'approval.resolved',
      agentId: input.agent.agentId,
      runId: input.execution.runId,
      executionId: input.execution.executionId,
      message: renderApprovalResolvedMessage(input),
    })
  }

  async sendDeadManSwitchTriggered(input: {
    agent: AgentRecord
    controlEvent: AgentControlEventRecord
  }): Promise<SendAlertResult> {
    return this.sendTextAlert({
      type: 'dead_man_switch.triggered',
      agentId: input.agent.agentId,
      controlEventId: input.controlEvent.controlEventId,
      message: renderDeadManSwitchMessage(input),
    })
  }
}
