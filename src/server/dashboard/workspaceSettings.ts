import {
  isAgentSettlementMode,
  normalizeAgentSettlementMode,
  type AgentSettlementMode,
} from '../../store/AgentRegistry.js'
import type {
  DashboardWorkspaceRecord,
  DashboardWorkspaceRegistry,
  DashboardWorkspaceSettings,
} from '../../store/DashboardWorkspaceRegistry.js'
import { readDashboardWorkspaceId } from './access.js'
import type { Env } from './shared.js'
import { readMaybeString, readRecord } from './shared.js'

function readWorkspaceDisplayName(env: Env): string {
  return (
    env.PALMOS_WORKSPACE_DISPLAY_NAME?.trim() ||
    env.PALMOS_ORG_NAME?.trim() ||
    'PalmOS Workspace'
  )
}

function readOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    return new URL(trimmed).origin
  } catch {
    return undefined
  }
}

function readUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    return new URL(trimmed).toString()
  } catch {
    return undefined
  }
}

function readSettlementMode(value: string | undefined): AgentSettlementMode | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  return isAgentSettlementMode(trimmed)
    ? normalizeAgentSettlementMode(trimmed)
    : undefined
}

function readEnvWorkspaceSettings(env: Env): DashboardWorkspaceSettings {
  return {
    defaultPolicyTemplateId:
      env.PALMOS_DEFAULT_POLICY_TEMPLATE_ID?.trim() || undefined,
    defaultApprovalRoute:
      env.PALMOS_DEFAULT_APPROVAL_ROUTE?.trim() || undefined,
    defaultSettlementMode: readSettlementMode(
      env.PALMOS_DEFAULT_SETTLEMENT_MODE,
    ),
    sdkApiBaseUrl: readUrl(env.PALMOS_SDK_API_BASE_URL),
    frontendOrigin: readOrigin(env.PALMOS_FRONTEND_ORIGIN),
  }
}

export async function ensureDashboardWorkspaceRecord(input: {
  registry: DashboardWorkspaceRegistry
  env: Env
  now?: () => string
}): Promise<DashboardWorkspaceRecord> {
  const workspaceId = readDashboardWorkspaceId(input.env)
  const existing = await input.registry.get(workspaceId)
  const at = input.now?.() ?? new Date().toISOString()
  const record: DashboardWorkspaceRecord = {
    workspaceId,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    displayName: existing?.displayName ?? readWorkspaceDisplayName(input.env),
    status: existing?.status ?? 'active',
    settings: {
      ...readEnvWorkspaceSettings(input.env),
      ...existing?.settings,
    },
  }

  await input.registry.put(record)
  return record
}

export function readDashboardWorkspacePatch(value: unknown): {
  displayName?: string
  settings: DashboardWorkspaceSettings
} {
  const candidate = readRecord(value)
  const displayName = readMaybeString(candidate.displayName)
  const defaultPolicyTemplateId = readMaybeString(
    candidate.defaultPolicyTemplateId,
  )
  const defaultApprovalRoute = readMaybeString(candidate.defaultApprovalRoute)
  const sdkApiBaseUrl = readUrl(readMaybeString(candidate.sdkApiBaseUrl))
  const frontendOrigin = readOrigin(readMaybeString(candidate.frontendOrigin))
  const defaultSettlementMode = readSettlementMode(
    readMaybeString(candidate.defaultSettlementMode),
  )

  return {
    displayName,
    settings: {
      defaultPolicyTemplateId,
      defaultApprovalRoute,
      defaultSettlementMode,
      sdkApiBaseUrl,
      frontendOrigin,
    },
  }
}

export function applyDashboardWorkspacePatch(input: {
  workspace: DashboardWorkspaceRecord
  patch: ReturnType<typeof readDashboardWorkspacePatch>
  now?: () => string
}): DashboardWorkspaceRecord {
  return {
    ...input.workspace,
    updatedAt: input.now?.() ?? new Date().toISOString(),
    displayName: input.patch.displayName ?? input.workspace.displayName,
    settings: {
      ...input.workspace.settings,
      ...Object.fromEntries(
        Object.entries(input.patch.settings).filter(
          ([, value]) => value !== undefined,
        ),
      ),
    },
  }
}
