import type {
  KernelInput,
  PolicyExecutionMode,
  PolicyProfile,
  RuntimeEnvironment,
  SessionState,
  SignerClass,
  TrustTier,
  RunState,
} from '../../runtime/index.js'

export type AgentVendorRule = {
  vendorId: string
  label?: string
  destinationAddress: string
  chainId: string
}

export type AgentPolicyTemplateInput = {
  agentId: string
  organizationId: string
  environment: RuntimeEnvironment
  walletType: 'ops' | 'vendor' | 'user' | 'treasury'
  mode?: PolicyExecutionMode
  allowedChains: string[]
  allowedAssets: string[]
  allowedSignerClasses?: SignerClass[]
  allowedVendors: AgentVendorRule[]
  autoApproveUnder: string
  maxPerTransaction: string
  sessionBudget?: string
  heartbeatTimeoutSeconds: number
  requireSanctionsScreening?: boolean
  policyProfileId?: string
  approvalExpirySeconds?: number
  minimumWalletTrustTier?: TrustTier
}

export type AgentTrustTier = 'new' | 'healthy' | 'trusted' | 'restricted'

export type SpendDecision =
  | {
      status: 'allowed'
      requiresApproval: false
      effectiveMaxPerTransaction: string
      reasonCode: 'policy.auto_approved'
    }
  | {
      status: 'restricted'
      requiresApproval: true
      effectiveMaxPerTransaction: string
      reasonCode: 'policy.approval_required'
    }
  | {
      status: 'denied'
      requiresApproval: false
      effectiveMaxPerTransaction: string
      reasonCode:
        | 'policy.vendor_not_allowed'
        | 'policy.agent_restricted'
        | 'policy.amount_exceeds_limit'
    }

export type AgentPolicyLookupRecord = {
  agentId: string
  actorId: string
  organizationId: string
  treasuryId?: string
  environment: RuntimeEnvironment
  walletId?: string
  walletType: AgentPolicyTemplateInput['walletType']
  trustTier: AgentTrustTier
  policyConfig: AgentPolicyTemplateInput
}

export interface AgentPolicyLookup {
  get(agentId: string): Promise<AgentPolicyLookupRecord | undefined>
  getByActorId(actorId: string): Promise<AgentPolicyLookupRecord | undefined>
  getByWalletId(walletId: string): Promise<AgentPolicyLookupRecord | undefined>
}

function parseAmount(amount: string): number {
  const parsed = Number(amount)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatAmount(amount: number): string {
  return amount.toFixed(2)
}

function getTrustMultiplier(trustTier: AgentTrustTier): number {
  switch (trustTier) {
    case 'trusted':
      return 2
    case 'healthy':
      return 1
    case 'new':
      return 0.25
    case 'restricted':
      return 0
    default:
      return 1
  }
}

export function evaluateSpendRequest(input: {
  policy: AgentPolicyTemplateInput
  amount: string
  vendorId?: string
  trustTier: AgentTrustTier
}): SpendDecision {
  const effectiveMaxPerTransaction = formatAmount(
    parseAmount(input.policy.maxPerTransaction) * getTrustMultiplier(input.trustTier),
  )

  if (input.trustTier === 'restricted') {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxPerTransaction,
      reasonCode: 'policy.agent_restricted',
    }
  }

  if (
    input.vendorId &&
    !input.policy.allowedVendors.some((vendor) => vendor.vendorId === input.vendorId)
  ) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxPerTransaction,
      reasonCode: 'policy.vendor_not_allowed',
    }
  }

  if (parseAmount(input.amount) > parseAmount(effectiveMaxPerTransaction)) {
    return {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxPerTransaction,
      reasonCode: 'policy.amount_exceeds_limit',
    }
  }

  if (parseAmount(input.amount) > parseAmount(input.policy.autoApproveUnder)) {
    return {
      status: 'restricted',
      requiresApproval: true,
      effectiveMaxPerTransaction,
      reasonCode: 'policy.approval_required',
    }
  }

  return {
    status: 'allowed',
    requiresApproval: false,
    effectiveMaxPerTransaction,
    reasonCode: 'policy.auto_approved',
  }
}

export function compileAgentProvisioningPolicy(input: {
  agentId: string
  organizationId: string
  environment: RuntimeEnvironment
  allowedChains: string[]
  allowedSignerClasses: SignerClass[]
  policyProfileId?: string
  now: string
}): PolicyProfile {
  return {
    policyProfileId:
      input.policyProfileId ?? `policy_agent_${input.agentId}_provisioning`,
    version: 'v1',
    createdAt: input.now,
    updatedAt: input.now,
    owner: {
      organizationId: input.organizationId,
    },
    mode: 'copilot',
    scope: {
      environments: [input.environment],
      allowedChains: input.allowedChains,
    },
    permissions: {
      actions: {
        'wallet.create': {
          enabled: true,
          allowedSignerClasses: input.allowedSignerClasses,
        },
      },
      counterparty: {},
      protocols: {},
      signer: {
        allowedSignerClasses: input.allowedSignerClasses,
      },
      simulation: {},
    },
    approvals: {},
    identity: {},
    trust: {},
    emergency: {
      emergencyHaltEnabled: true,
    },
  }
}

export function compileAgentPolicy(input: {
  policy: AgentPolicyTemplateInput
  walletId: string
  now: string
  decision?: SpendDecision
}): PolicyProfile {
  const signerClasses = input.policy.allowedSignerClasses ?? ['multisig']
  const policyProfileId =
    input.policy.policyProfileId ?? `policy_agent_${input.policy.agentId}`
  const resolvedDecision =
    input.decision ??
    ({
      status: 'allowed',
      requiresApproval: false,
      effectiveMaxPerTransaction: input.policy.maxPerTransaction,
      reasonCode: 'policy.auto_approved',
    } satisfies SpendDecision)

  return {
    policyProfileId,
    version: 'v1',
    createdAt: input.now,
    updatedAt: input.now,
    owner: {
      organizationId: input.policy.organizationId,
      walletId: input.walletId,
    },
    mode: input.policy.mode ?? 'copilot',
    scope: {
      environments: [input.policy.environment],
      allowedChains: input.policy.allowedChains,
      allowedWalletIds: [input.walletId],
      allowedAssets: input.policy.allowedAssets,
    },
    permissions: {
      actions: {
        'asset.transfer': {
          enabled: resolvedDecision.status !== 'denied',
          maxPerTransaction: resolvedDecision.effectiveMaxPerTransaction,
          allowedSignerClasses: signerClasses,
          simulationRequired: true,
          approvalRequired: resolvedDecision.requiresApproval,
          allowActiveLimitedAutoApproval: !resolvedDecision.requiresApproval,
        },
      },
      allowedAssets: input.policy.allowedAssets,
      counterparty: {
        allowlistedRecipientOnly: true,
        approvedCounterpartyIds: input.policy.allowedVendors.map(
          (vendor) => vendor.vendorId,
        ),
      },
      protocols: {},
      signer: {
        allowedSignerClasses: signerClasses,
      },
      simulation: {
        requireTransferSimulation: true,
        simulationFreshnessSeconds: 300,
        requireResultHashMatch: true,
      },
    },
    approvals: resolvedDecision.requiresApproval
      ? {
          'asset.transfer': {
            singleApprovalUnder: resolvedDecision.effectiveMaxPerTransaction,
            requiredRoles: ['manager'],
            approvalExpirySeconds: input.policy.approvalExpirySeconds ?? 900,
          },
        }
      : {},
    identity: {
      requireSanctionsScreeningBeforeTransfer:
        input.policy.requireSanctionsScreening ?? true,
    },
    trust: {
      minimumWalletTrustTier: input.policy.minimumWalletTrustTier,
    },
    emergency: {
      emergencyHaltEnabled: true,
    },
  }
}

async function resolveAgentForRun(input: {
  lookup: AgentPolicyLookup
  session: SessionState
  run: RunState
  kernelInput: KernelInput
}): Promise<AgentPolicyLookupRecord | undefined> {
  if (input.run.actionType === 'wallet.create') {
    const subjectId =
      typeof input.kernelInput.payload?.subjectId === 'string'
        ? input.kernelInput.payload.subjectId
        : undefined
    return subjectId ? input.lookup.get(subjectId) : undefined
  }

  const actorMatch = await input.lookup.getByActorId(input.session.actorContext.actorId)
  if (actorMatch) {
    return actorMatch
  }

  const walletId = input.session.orgContext.walletIds?.[0]
  return walletId ? input.lookup.getByWalletId(walletId) : undefined
}

export function createAgentPolicyCandidateResolver(input: {
  agentRegistry: AgentPolicyLookup
  now?: () => string
}): (input: {
  session: SessionState
  run: RunState
  kernelInput: KernelInput
}) => Promise<PolicyProfile[]> {
  const now = input.now ?? (() => new Date().toISOString())

  return async ({ session, run, kernelInput }) => {
    const agent = await resolveAgentForRun({
      lookup: input.agentRegistry,
      session,
      run,
      kernelInput,
    })
    if (!agent) {
      return []
    }

    if (run.actionType === 'wallet.create') {
      return [
        compileAgentProvisioningPolicy({
          agentId: agent.agentId,
          organizationId: agent.organizationId,
          environment: agent.environment,
          allowedChains: agent.policyConfig.allowedChains,
          allowedSignerClasses:
            agent.policyConfig.allowedSignerClasses ?? ['multisig'],
          policyProfileId: `${agent.policyConfig.policyProfileId ?? `policy_agent_${agent.agentId}`}_provisioning`,
          now: now(),
        }),
      ]
    }

    if (run.actionType === 'asset.transfer' && agent.walletId) {
      const amount =
        typeof kernelInput.payload?.amount === 'string'
          ? kernelInput.payload.amount
          : '0'
      const vendorId =
        typeof kernelInput.payload?.counterpartyId === 'string'
          ? kernelInput.payload.counterpartyId
          : undefined

      const decision = evaluateSpendRequest({
        policy: agent.policyConfig,
        amount,
        vendorId,
        trustTier: agent.trustTier,
      })

      return [
        compileAgentPolicy({
          policy: agent.policyConfig,
          walletId: agent.walletId,
          now: now(),
          decision,
        }),
      ]
    }

    return []
  }
}
