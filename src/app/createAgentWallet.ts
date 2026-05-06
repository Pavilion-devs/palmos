import type {
  KernelTurnResult,
  RuntimeEnvironment,
  SessionKernel,
  WalletRegistry,
} from '../../runtime/index.js'
import type { AgentRegistry, AgentRecord } from '../store/AgentRegistry.js'
import type { AgentPolicyTemplateInput } from '../policies/compileAgentPolicy.js'
import type { OwsClient } from '../integrations/ows/client.js'
import type { OwsAccessRegistry } from '../store/OwsAccessRegistry.js'

export type CreateAgentWalletInput = {
  agentId: string
  displayName: string
  organizationId: string
  treasuryId?: string
  environment: RuntimeEnvironment
  managerActorId: string
  managerRoleIds: string[]
  walletType: AgentPolicyTemplateInput['walletType']
  subjectType?: 'individual' | 'team' | 'business'
  signerProfileId?: string
  policyConfig: AgentPolicyTemplateInput
  xmtpInboxId?: string
  owsImportPrivateKeyHex?: string
}

export type CreateAgentWalletDependencies = {
  kernel: SessionKernel
  agentRegistry: AgentRegistry
  walletRegistry: WalletRegistry
  owsClient?: OwsClient
  owsAccessRegistry?: OwsAccessRegistry
  now?: () => string
}

function getManagerSessionId(input: CreateAgentWalletInput): string {
  return `manager:${input.organizationId}`
}

function getAgentActorId(agentId: string): string {
  return `agent:${agentId}`
}

export async function createAgentWallet(
  deps: CreateAgentWalletDependencies,
  input: CreateAgentWalletInput,
): Promise<{
  agent: AgentRecord
  run: KernelTurnResult['run']
  turn: KernelTurnResult
}> {
  const at = deps.now?.() ?? new Date().toISOString()
  const existing = await deps.agentRegistry.get(input.agentId)
  if (existing) {
    throw new Error(`Agent ${input.agentId} already exists.`)
  }

  const draftAgent: AgentRecord = {
    agentId: input.agentId,
    createdAt: at,
    updatedAt: at,
    displayName: input.displayName,
    organizationId: input.organizationId,
    treasuryId: input.treasuryId,
    environment: input.environment,
    actorId: getAgentActorId(input.agentId),
    sessionId: `agent:${input.agentId}`,
    walletType: input.walletType,
    policyProfileId:
      input.policyConfig.policyProfileId ?? `policy_agent_${input.agentId}`,
    policyConfig: input.policyConfig,
    trustTier: 'new',
    status: 'wallet_pending',
    lastCheckInAt: at,
    xmtpInboxId: input.xmtpInboxId,
  }
  await deps.agentRegistry.put(draftAgent)

  const session = await deps.kernel.loadOrCreateSession({
    sessionId: getManagerSessionId(input),
    mode: 'api',
    environment: input.environment,
    orgContext: {
      organizationId: input.organizationId,
      treasuryIds: input.treasuryId ? [input.treasuryId] : undefined,
    },
    actorContext: {
      actorId: input.managerActorId,
      roleIds: input.managerRoleIds,
    },
  })

  const turn = await deps.kernel.handleInput({
    sessionId: session.sessionId,
    source: 'api',
    requestedActionType: 'wallet.create',
    payload: {
      subjectId: input.agentId,
      subjectType: input.subjectType ?? 'team',
      walletType: input.walletType,
      initialPolicyProfileId: draftAgent.policyProfileId,
      signerProfileId: input.signerProfileId,
    },
  })

  const organizationWallets = await deps.walletRegistry.listByOrganization(
    input.organizationId,
  )
  const createdWallet = organizationWallets
    .filter((wallet) => wallet.subjectId === input.agentId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]

  if (!createdWallet) {
    const failedAgent: AgentRecord = {
      ...draftAgent,
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      status: 'failed',
    }
    await deps.agentRegistry.put(failedAgent)
    throw new Error(`Wallet provisioning for agent ${input.agentId} did not produce a wallet record.`)
  }

  const agent: AgentRecord = {
    ...draftAgent,
    updatedAt: deps.now?.() ?? new Date().toISOString(),
    walletId: createdWallet.walletId,
    walletState: createdWallet.state,
    signerProfileId: createdWallet.signerProfileId,
    status: 'ready',
  }

  if (deps.owsClient) {
    const owsWallet = await deps.owsClient.ensureWallet({
      name: input.agentId,
      importPrivateKeyHex: input.owsImportPrivateKeyHex,
      importChain: 'evm',
    })

    const owsApiKey = deps.owsClient.createApiKey({
      name: `${input.agentId}-agent-key`,
      walletIds: [owsWallet.wallet.id],
      policyIds: [],
    })

    const updatedWalletRecord = {
      ...createdWallet,
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      address: owsWallet.evmAddress ?? createdWallet.address,
      providerId: 'ows_wallet_provider',
      providerWalletId: owsWallet.wallet.id,
      providerWalletName: owsWallet.wallet.name,
      providerVaultPath: deps.owsClient.vaultPath,
    }
    await deps.walletRegistry.put(updatedWalletRecord)
    await deps.owsAccessRegistry?.put({
      agentId: input.agentId,
      createdAt: at,
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      runtimeWalletId: createdWallet.walletId,
      owsWalletId: owsWallet.wallet.id,
      owsWalletName: owsWallet.wallet.name,
      vaultPath: deps.owsClient.vaultPath,
      apiKeyId: owsApiKey.id,
      apiKeyName: owsApiKey.name,
      apiKeyToken: owsApiKey.token,
    })

    agent.walletBackend = 'ows'
    agent.owsWalletId = owsWallet.wallet.id
    agent.owsWalletName = owsWallet.wallet.name
    agent.owsApiKeyId = owsApiKey.id
    agent.owsVaultPath = deps.owsClient.vaultPath
    agent.walletState = updatedWalletRecord.state
  }

  await deps.agentRegistry.put(agent)

  return {
    agent,
    run: turn.run,
    turn,
  }
}
