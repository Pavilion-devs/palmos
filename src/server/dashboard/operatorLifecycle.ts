import type {
  DashboardOperatorRecord,
  DashboardOperatorRole,
} from '../../store/DashboardOperatorRegistry.js'
import { readDashboardWorkspaceId } from './access.js'
import type { Env } from './shared.js'
import { readMaybeString, readRecord } from './shared.js'

export type DashboardManagedOperatorRole = Exclude<
  DashboardOperatorRole,
  'judge'
>

export type DashboardOperatorPatch = {
  operatorId?: string
  displayName?: string
  role?: DashboardManagedOperatorRole
}

function normalizeOperatorId(value: string | undefined): string | undefined {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96)
  return normalized || undefined
}

function readManagedRole(value: string | undefined): DashboardManagedOperatorRole | undefined {
  const normalized = value?.trim()
  return normalized === 'owner' ||
    normalized === 'operator' ||
    normalized === 'viewer'
    ? normalized
    : undefined
}

export function readDashboardOperatorPatch(value: unknown): DashboardOperatorPatch {
  const candidate = readRecord(value)
  return {
    operatorId: normalizeOperatorId(readMaybeString(candidate.operatorId)),
    displayName: readMaybeString(candidate.displayName),
    role: readManagedRole(readMaybeString(candidate.role)),
  }
}

export function createDashboardOperatorRecord(input: {
  env: Env
  patch: DashboardOperatorPatch
  existing?: DashboardOperatorRecord
  now?: () => string
}): DashboardOperatorRecord | undefined {
  const operatorId = input.existing?.operatorId ?? input.patch.operatorId
  if (!operatorId) {
    return undefined
  }

  const at = input.now?.() ?? new Date().toISOString()
  return {
    operatorId,
    workspaceId:
      input.existing?.workspaceId ?? readDashboardWorkspaceId(input.env),
    createdAt: input.existing?.createdAt ?? at,
    updatedAt: at,
    displayName:
      input.patch.displayName ??
      input.existing?.displayName ??
      'Workspace Operator',
    role: input.patch.role ?? input.existing?.role ?? 'operator',
    status: input.existing?.status ?? 'active',
    source: input.existing?.source ?? 'env',
    lastLoginAt: input.existing?.lastLoginAt,
  }
}

export function setDashboardOperatorStatus(input: {
  operator: DashboardOperatorRecord
  status: DashboardOperatorRecord['status']
  now?: () => string
}): DashboardOperatorRecord {
  return {
    ...input.operator,
    status: input.status,
    updatedAt: input.now?.() ?? new Date().toISOString(),
  }
}

export function sanitizeDashboardOperator(record: DashboardOperatorRecord) {
  return {
    operatorId: record.operatorId,
    workspaceId: record.workspaceId,
    displayName: record.displayName,
    role: record.role,
    status: record.status,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastLoginAt: record.lastLoginAt,
  }
}
