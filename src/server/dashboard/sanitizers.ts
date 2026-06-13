import type {
  DashboardAgentRoster,
  DashboardAgentWalletList,
  PusdResearchWorkerResult,
  RegisteredPalmosServiceRecord,
  ShowcaseSnapshot,
} from '../../index.js'

export function stripAgentSecrets<T extends { owsVaultPath?: string }>(
  agent: T,
): Omit<T, 'owsVaultPath'> {
  const { owsVaultPath: _owsVaultPath, ...safeAgent } = agent
  if (
    safeAgent &&
    typeof safeAgent === 'object' &&
    'policyConfig' in safeAgent &&
    safeAgent.policyConfig &&
    typeof safeAgent.policyConfig === 'object' &&
    !('privacyMode' in safeAgent)
  ) {
    const policyConfig = safeAgent.policyConfig as { privacyMode?: unknown; umbra?: unknown }
    ;(safeAgent as { privacyMode?: unknown }).privacyMode =
      policyConfig.privacyMode ?? (policyConfig.umbra ? 'allowed' : 'disabled')
  }
  return safeAgent
}

export function sanitizeSnapshot(snapshot: ShowcaseSnapshot): ShowcaseSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map((agentSnapshot) => ({
      ...agentSnapshot,
      agent: stripAgentSecrets(agentSnapshot.agent),
      owsAccess: agentSnapshot.owsAccess
        ? {
            agentId: agentSnapshot.owsAccess.agentId,
            createdAt: agentSnapshot.owsAccess.createdAt,
            updatedAt: agentSnapshot.owsAccess.updatedAt,
            runtimeWalletId: agentSnapshot.owsAccess.runtimeWalletId,
            owsWalletId: agentSnapshot.owsAccess.owsWalletId,
            owsWalletName: agentSnapshot.owsAccess.owsWalletName,
            vaultPath: agentSnapshot.owsAccess.vaultPath,
            apiKeyId: agentSnapshot.owsAccess.apiKeyId,
            apiKeyName: agentSnapshot.owsAccess.apiKeyName,
          }
        : undefined,
      audit: {
        ...agentSnapshot.audit,
        agent: stripAgentSecrets(agentSnapshot.audit.agent),
      },
    })),
  }
}

export function sanitizeAgentRoster(
  snapshot: DashboardAgentRoster,
): DashboardAgentRoster {
  return {
    ...snapshot,
    agents: snapshot.agents.map((entry) => ({
      ...entry,
      agent: stripAgentSecrets(entry.agent),
    })),
  }
}

export function sanitizeAgentWalletList(
  snapshot: DashboardAgentWalletList,
): DashboardAgentWalletList {
  return {
    ...snapshot,
    agents: snapshot.agents.map((entry) => ({
      ...entry,
      agent: stripAgentSecrets(entry.agent),
    })),
  }
}

export function sanitizeWorkerResult(result: PusdResearchWorkerResult) {
  return {
    ...result,
    agent: stripAgentSecrets(result.agent),
    execution: {
      ...result.execution,
      agent: stripAgentSecrets(result.execution.agent),
    },
  }
}

export function sanitizeCredential(record: {
  credentialId: string
  agentId: string
  label: string
  keyPrefix: string
  status: string
  createdAt?: string
  updatedAt?: string
  lastUsedAt?: string
}) {
  return {
    credentialId: record.credentialId,
    agentId: record.agentId,
    label: record.label,
    keyPrefix: record.keyPrefix,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt,
  }
}

export function sanitizeService(record: RegisteredPalmosServiceRecord) {
  return {
    serviceId: record.serviceId,
    label: record.label,
    vendorId: record.vendorId,
    destinationAddress: record.destinationAddress,
    endpointUrl: record.endpointUrl,
    method: record.method,
    requestMode: record.requestMode,
    expectedAmount: record.expectedAmount,
    chainId: record.chainId,
    status: record.status,
    verificationStatus: record.verificationStatus ?? 'unchecked',
    verifiedAt: record.verifiedAt,
    lastVerificationError: record.lastVerificationError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
