import type {
  KernelTurnResult,
  RuntimeEnvironment,
  SessionKernel,
  WalletRegistry,
} from '../../runtime/index.js'
import type {
  AgentRegistry,
  AgentRecord,
  AgentSettlementMode,
} from '../store/AgentRegistry.js'
import type {
  ActionRequestRecord,
  ActionRequestRegistry,
} from '../store/ActionRequestRegistry.js'
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
  settlementMode?: AgentSettlementMode
  subjectType?: 'individual' | 'team' | 'business'
  signerProfileId?: string
  policyConfig: AgentPolicyTemplateInput
  xmtpInboxId?: string
  owsImportPrivateKey?: string
  owsImportChain?: string
}

export type CreateAgentWalletDependencies = {
  kernel: SessionKernel
  agentRegistry: AgentRegistry
  walletRegistry: WalletRegistry
  actionRequests?: ActionRequestRegistry
  owsClient?: OwsClient
  owsAccessRegistry?: OwsAccessRegistry
  now?: () => string
  createId?: (prefix: string) => string
}

function getManagerSessionId(input: CreateAgentWalletInput): string {
  return `manager:${input.organizationId}`
}

function getAgentActorId(agentId: string): string {
  return `agent:${agentId}`
}

function createActionRequestId(
  deps: Pick<CreateAgentWalletDependencies, 'createId'>,
): string {
  return deps.createId
    ? deps.createId('action_request')
    : `action_request_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function buildWalletCreateActionRequest(input: {
  actionRequestId: string
  at: string
  request: CreateAgentWalletInput
}): ActionRequestRecord {
  return {
    actionRequestId: input.actionRequestId,
    createdAt: input.at,
    updatedAt: input.at,
    agentId: input.request.agentId,
    organizationId: input.request.organizationId,
    treasuryId: input.request.treasuryId,
    source: 'dashboard',
    kind: 'wallet.create',
    status: 'created',
    target: {
      kind: 'wallet',
      walletId: `agent:${input.request.agentId}`,
      chainId: input.request.policyConfig.allowedChains?.[0],
    },
    title: 'Create agent wallet',
    summary: `Requested wallet creation for ${input.request.displayName}.`,
    requestPayload: {
      agentId: input.request.agentId,
      displayName: input.request.displayName,
      organizationId: input.request.organizationId,
      treasuryId: input.request.treasuryId,
      environment: input.request.environment,
      walletType: input.request.walletType,
      settlementMode: input.request.settlementMode,
      subjectType: input.request.subjectType ?? 'team',
      signerProfileId: input.request.signerProfileId,
      policyProfileId:
        input.request.policyConfig.policyProfileId ??
        `policy_agent_${input.request.agentId}`,
      owsImportRequested: Boolean(input.request.owsImportPrivateKey),
      owsImportChain: input.request.owsImportChain,
    },
    requestContext: {
      nativeActionRequest: true,
      requestSource: 'dashboard',
      intakeStage: 'created',
      managerActorId: input.request.managerActorId,
      managerRoleIds: input.request.managerRoleIds,
    },
    policy: {
      approvalRequired: false,
      limitsApplied: {
        nativeActionRequest: true,
        walletCreate: true,
      },
    },
    executionPlan: {
      connectorKind: 'direct',
      privacyMode: 'off',
      executionMode: 'connector',
    },
    runtimeRefs: {
      sessionId: getManagerSessionId(input.request),
      intentIds: [],
    },
  }
}

function markWalletCreateFailed(input: {
  record: ActionRequestRecord
  at: string
  errorCode: string
  errorMessage: string
  run?: KernelTurnResult['run']
  sessionId?: string
}): ActionRequestRecord {
  return {
    ...input.record,
    updatedAt: input.at,
    status: 'failed',
    runtimeRefs: {
      sessionId: input.sessionId ?? input.record.runtimeRefs?.sessionId,
      runId: input.run?.runId ?? input.record.runtimeRefs?.runId,
      intentIds: input.run?.intentRef?.intentId
        ? [input.run.intentRef.intentId]
        : input.record.runtimeRefs?.intentIds ?? [],
      simulationRefs: input.run?.simulationRefs,
      broadcastRefs: input.run?.broadcastRefs,
    },
    requestContext: {
      ...input.record.requestContext,
      intakeStage: 'failed',
      runtimeStatus: input.run?.status,
      runtimePhase: input.run?.currentPhase,
    },
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  }
}

function markWalletCreateExecuted(input: {
  record: ActionRequestRecord
  at: string
  walletId: string
  run?: KernelTurnResult['run']
  sessionId: string
}): ActionRequestRecord {
  return {
    ...input.record,
    updatedAt: input.at,
    walletId: input.walletId,
    status: 'executed',
    target: {
      kind: 'wallet',
      walletId: input.walletId,
      chainId:
        input.record.target.kind === 'wallet'
          ? input.record.target.chainId
          : undefined,
    },
    runtimeRefs: {
      sessionId: input.sessionId,
      runId: input.run?.runId,
      intentIds: input.run?.intentRef?.intentId
        ? [input.run.intentRef.intentId]
        : input.record.runtimeRefs?.intentIds ?? [],
      simulationRefs: input.run?.simulationRefs,
      broadcastRefs: input.run?.broadcastRefs,
    },
    resultRef: input.walletId,
    requestContext: {
      ...input.record.requestContext,
      intakeStage: 'executed',
      runtimeStatus: input.run?.status,
      runtimePhase: input.run?.currentPhase,
      reportRef: input.run?.reportRef,
    },
  }
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
    if (deps.actionRequests) {
      const duplicate = buildWalletCreateActionRequest({
        actionRequestId: createActionRequestId(deps),
        at,
        request: input,
      })
      await deps.actionRequests.put(
        markWalletCreateFailed({
          record: duplicate,
          at,
          errorCode: 'agent.already_exists',
          errorMessage: `Agent ${input.agentId} already exists.`,
        }),
      )
    }
    throw new Error(`Agent ${input.agentId} already exists.`)
  }
  const walletCreateActionRequest = deps.actionRequests
    ? buildWalletCreateActionRequest({
        actionRequestId: createActionRequestId(deps),
        at,
        request: input,
      })
    : undefined
  if (walletCreateActionRequest) {
    await deps.actionRequests?.put(walletCreateActionRequest)
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
    settlementMode: input.settlementMode ?? 'local-demo',
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

  let turn: KernelTurnResult
  try {
    turn = await deps.kernel.handleInput({
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
  } catch (error) {
    if (walletCreateActionRequest) {
      await deps.actionRequests?.put(
        markWalletCreateFailed({
          record: walletCreateActionRequest,
          at: deps.now?.() ?? new Date().toISOString(),
          errorCode: 'runtime.wallet_create_failed',
          errorMessage:
            error instanceof Error
              ? error.message
              : 'Wallet creation runtime failed.',
          sessionId: session.sessionId,
        }),
      )
    }
    throw error
  }

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
    if (walletCreateActionRequest) {
      await deps.actionRequests?.put(
        markWalletCreateFailed({
          record: walletCreateActionRequest,
          at: failedAgent.updatedAt,
          errorCode: 'wallet.create_missing_wallet',
          errorMessage: `Wallet provisioning for agent ${input.agentId} did not produce a wallet record.`,
          run: turn.run,
          sessionId: turn.session.sessionId,
        }),
      )
    }
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
    let owsWallet
    try {
      owsWallet = await deps.owsClient.ensureWallet({
        name: input.agentId,
        importPrivateKey: input.owsImportPrivateKey,
        importChain: input.owsImportChain,
      })
    } catch (error) {
      if (walletCreateActionRequest) {
        await deps.actionRequests?.put(
          markWalletCreateFailed({
            record: walletCreateActionRequest,
            at: deps.now?.() ?? new Date().toISOString(),
            errorCode: 'ows.wallet_create_failed',
            errorMessage:
              error instanceof Error
                ? error.message
                : 'OWS wallet provisioning failed.',
            run: turn.run,
            sessionId: turn.session.sessionId,
          }),
        )
      }
      throw error
    }

    const owsApiKey = deps.owsClient.createApiKey({
      name: `${input.agentId}-agent-key`,
      walletIds: [owsWallet.wallet.id],
      policyIds: [],
    })

    const updatedWalletRecord = {
      ...createdWallet,
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      address:
        owsWallet.solanaAddress ??
        owsWallet.evmAddress ??
        createdWallet.address,
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
  if (walletCreateActionRequest) {
    await deps.actionRequests?.put(
      markWalletCreateExecuted({
        record: walletCreateActionRequest,
        at: agent.updatedAt,
        walletId: agent.walletId ?? createdWallet.walletId,
        run: turn.run,
        sessionId: turn.session.sessionId,
      }),
    )
  }

  return {
    agent,
    run: turn.run,
    turn,
  }
}
