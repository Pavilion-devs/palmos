import type express from 'express'

export type Env = Record<string, string | undefined>

export type DashboardOnboardingSetup = {
  agentName?: string
  agentTask?: string
  maxPerCall?: string
  sessionBudget?: string
  autoApproveUnder?: string
  allowedVendors?: string[]
  walletMode?: string
  managerAddress?: string
}

export function readMaybeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function readAuthToken(req: express.Request): string | undefined {
  const authorization = req.headers.authorization
  const authorizationValue = Array.isArray(authorization)
    ? authorization[0]
    : authorization
  if (authorizationValue?.startsWith('Bearer ')) {
    return authorizationValue.slice('Bearer '.length).trim()
  }

  const agentKey = req.headers['x-palmos-agent-key']
  const agentKeyValue = Array.isArray(agentKey) ? agentKey[0] : agentKey
  return readMaybeString(agentKeyValue)
}

export function readOnboardingSetup(
  value: unknown,
): DashboardOnboardingSetup | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  return {
    agentName: readMaybeString(candidate.agentName),
    agentTask: readMaybeString(candidate.agentTask),
    maxPerCall: readMaybeString(candidate.maxPerCall),
    sessionBudget: readMaybeString(candidate.sessionBudget),
    autoApproveUnder: readMaybeString(candidate.autoApproveUnder),
    allowedVendors: Array.isArray(candidate.allowedVendors)
      ? candidate.allowedVendors
          .map((vendor) => readMaybeString(vendor))
          .filter((vendor): vendor is string => Boolean(vendor))
      : undefined,
    walletMode: readMaybeString(candidate.walletMode),
    managerAddress: readMaybeString(candidate.managerAddress),
  }
}

