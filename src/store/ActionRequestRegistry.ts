import { mkdir, readdir, rm, rmdir } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { readJsonFile, writeJsonFile } from '../../runtime/runtime/jsonFile.js'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type ActionRequestStatus =
  | 'created'
  | 'policy_checked'
  | 'blocked'
  | 'approval_pending'
  | 'approved'
  | 'waiting_for_execution'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'cancelled'
  | 'expired'

export type ActionRequestKind =
  | 'service.pay'
  | 'asset.transfer'
  | 'asset.swap'
  | 'asset.liquidity'
  | 'asset.bridge'
  | 'portfolio.rebalance'
  | 'wallet.create'
  | 'wallet.policy_update'

export type ActionRequestSource =
  | 'dashboard'
  | 'sdk'
  | 'worker'
  | 'mcp'
  | 'system'

export type ActionTarget =
  | {
      kind: 'service'
      serviceId: string
      vendorId?: string
      endpointUrl?: string
    }
  | {
      kind: 'address'
      address: string
      chainId: string
      counterpartyId?: string
    }
  | {
      kind: 'wallet'
      walletId: string
      chainId?: string
    }
  | {
      kind: 'portfolio'
      portfolioId: string
    }

export type ActionValue =
  | {
      assetSymbol: string
      amount: string
      chainId?: string
      valueUsd?: string
    }
  | undefined

export type ActionPolicySnapshot = {
  policyVersion?: string
  policyHash?: string
  approvalRequired: boolean
  approvalReason?: string
  limitsApplied?: Record<string, unknown>
}

export type ActionExecutionPlan = {
  connectorId?: string
  connectorKind?: 'pusd' | 'umbra' | 'delora' | 'direct' | string
  settlementAsset?: string
  privacyMode?: 'off' | 'on' | 'required'
  quoteRef?: string
  quoteExpiresAt?: string
  executionMode?: 'local-demo' | 'ows' | 'real-solana' | 'connector' | string
}

export type ActionRuntimeRefs = {
  sessionId?: string
  runId?: string
  intentIds: string[]
  broadcastRefs?: string[]
  simulationRefs?: string[]
}

export type ActionRequestRecord = {
  actionRequestId: string
  createdAt: string
  updatedAt: string
  agentId: string
  organizationId?: string
  treasuryId?: string
  walletId?: string
  source: ActionRequestSource
  kind: ActionRequestKind
  status: ActionRequestStatus
  target: ActionTarget
  value?: ActionValue
  title: string
  summary: string
  requestPayload: Record<string, unknown>
  requestContext?: Record<string, unknown>
  policy: ActionPolicySnapshot
  executionPlan?: ActionExecutionPlan
  runtimeRefs?: ActionRuntimeRefs
  resultRef?: string
  errorCode?: string
  errorMessage?: string
}

export type ActionRequestQuery = {
  agentId?: string
  status?: ActionRequestStatus
  kind?: ActionRequestKind
  source?: ActionRequestSource
  limit?: number
}

export type ActionRequestQuerySummary = {
  totalMatching: number
  byStatus: Partial<Record<ActionRequestStatus, number>>
  byKind: Partial<Record<ActionRequestKind, number>>
  bySource: Partial<Record<ActionRequestSource, number>>
}

export type ActionRequestQueryResult = {
  records: ActionRequestRecord[]
  summary: ActionRequestQuerySummary
}

export function normalizeActionRequestRecord(
  record: ActionRequestRecord,
): ActionRequestRecord {
  return record.source
    ? record
    : {
        ...record,
        source: 'system',
      }
}

export interface ActionRequestRegistry {
  get(actionRequestId: string): Promise<ActionRequestRecord | undefined>
  put(record: ActionRequestRecord): Promise<void>
  putIfStatus(
    record: ActionRequestRecord,
    expectedStatus: ActionRequestStatus,
  ): Promise<boolean>
  query(input: ActionRequestQuery): Promise<ActionRequestQueryResult>
  list(): Promise<ActionRequestRecord[]>
  remove(actionRequestId: string): Promise<void>
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getActionRequestsDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'action-requests')
}

function getActionRequestFilePath(
  actionRequestId: string,
  baseDir?: string,
): string {
  return join(getActionRequestsDir(baseDir), `${actionRequestId}.json`)
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquireActionRequestFileLock(lockDir: string): Promise<void> {
  const startedAt = Date.now()
  while (true) {
    try {
      await mkdir(lockDir)
      return
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'EEXIST' &&
        Date.now() - startedAt < 5_000
      ) {
        await wait(25)
        continue
      }

      throw error
    }
  }
}

function sortActionRequestsByRecency(
  left: ActionRequestRecord,
  right: ActionRequestRecord,
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.actionRequestId.localeCompare(left.actionRequestId)
  )
}

function matchesActionRequestQuery(
  record: ActionRequestRecord,
  input: ActionRequestQuery,
): boolean {
  if (input.agentId && record.agentId !== input.agentId) {
    return false
  }
  if (input.status && record.status !== input.status) {
    return false
  }
  if (input.kind && record.kind !== input.kind) {
    return false
  }
  if (input.source && record.source !== input.source) {
    return false
  }
  return true
}

function incrementCount<Key extends string>(
  counts: Partial<Record<Key, number>>,
  key: Key,
): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function summarizeActionRequests(
  records: ActionRequestRecord[],
): ActionRequestQuerySummary {
  const byStatus: Partial<Record<ActionRequestStatus, number>> = {}
  const byKind: Partial<Record<ActionRequestKind, number>> = {}
  const bySource: Partial<Record<ActionRequestSource, number>> = {}

  for (const record of records) {
    incrementCount(byStatus, record.status)
    incrementCount(byKind, record.kind)
    incrementCount(bySource, record.source)
  }

  return {
    totalMatching: records.length,
    byStatus,
    byKind,
    bySource,
  }
}

function queryActionRequestRecords(
  records: ActionRequestRecord[],
  input: ActionRequestQuery,
): ActionRequestQueryResult {
  const filtered = records
    .map(normalizeActionRequestRecord)
    .filter((record) => matchesActionRequestQuery(record, input))
    .sort(sortActionRequestsByRecency)

  return {
    records:
      input.limit == null ? filtered : filtered.slice(0, Math.max(0, input.limit)),
    summary: summarizeActionRequests(filtered),
  }
}

export class InMemoryActionRequestRegistry implements ActionRequestRegistry {
  private readonly records = new Map<string, ActionRequestRecord>()

  constructor(seedRecords: ActionRequestRecord[] = []) {
    for (const record of seedRecords) {
      const normalized = normalizeActionRequestRecord(record)
      this.records.set(normalized.actionRequestId, normalized)
    }
  }

  async get(actionRequestId: string): Promise<ActionRequestRecord | undefined> {
    const record = this.records.get(actionRequestId)
    return record ? normalizeActionRequestRecord(record) : undefined
  }

  async put(record: ActionRequestRecord): Promise<void> {
    const normalized = normalizeActionRequestRecord(record)
    this.records.set(normalized.actionRequestId, normalized)
  }

  async putIfStatus(
    record: ActionRequestRecord,
    expectedStatus: ActionRequestStatus,
  ): Promise<boolean> {
    const current = this.records.get(record.actionRequestId)
    if (current?.status !== expectedStatus) {
      return false
    }

    const normalized = normalizeActionRequestRecord(record)
    this.records.set(normalized.actionRequestId, normalized)
    return true
  }

  async list(): Promise<ActionRequestRecord[]> {
    return [...this.records.values()].map(normalizeActionRequestRecord)
  }

  async query(input: ActionRequestQuery): Promise<ActionRequestQueryResult> {
    return queryActionRequestRecords([...this.records.values()], input)
  }

  async remove(actionRequestId: string): Promise<void> {
    this.records.delete(actionRequestId)
  }
}

export class FileActionRequestRegistry implements ActionRequestRegistry {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async get(actionRequestId: string): Promise<ActionRequestRecord | undefined> {
    const record = await readJsonFile<ActionRequestRecord>(
      getActionRequestFilePath(actionRequestId, this.baseDir),
    )
    return record ? normalizeActionRequestRecord(record) : undefined
  }

  async put(record: ActionRequestRecord): Promise<void> {
    const normalized = normalizeActionRequestRecord(record)
    await mkdir(getActionRequestsDir(this.baseDir), { recursive: true })
    await writeJsonFile(
      getActionRequestFilePath(normalized.actionRequestId, this.baseDir),
      normalized,
    )
  }

  async putIfStatus(
    record: ActionRequestRecord,
    expectedStatus: ActionRequestStatus,
  ): Promise<boolean> {
    await mkdir(getActionRequestsDir(this.baseDir), { recursive: true })
    const lockDir = `${getActionRequestFilePath(record.actionRequestId, this.baseDir)}.lock`
    await acquireActionRequestFileLock(lockDir)
    try {
      const current = await this.get(record.actionRequestId)
      if (current?.status !== expectedStatus) {
        return false
      }

      await writeJsonFile(
        getActionRequestFilePath(record.actionRequestId, this.baseDir),
        normalizeActionRequestRecord(record),
      )
      return true
    } finally {
      await rmdir(lockDir).catch(() => undefined)
    }
  }

  async list(): Promise<ActionRequestRecord[]> {
    try {
      const entries = await readdir(getActionRequestsDir(this.baseDir), {
        withFileTypes: true,
      })
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<ActionRequestRecord>(
              join(getActionRequestsDir(this.baseDir), entry.name),
            ),
          ),
      )

      return records
        .filter((record): record is ActionRequestRecord => Boolean(record))
        .map(normalizeActionRequestRecord)
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return []
      }

      throw error
    }
  }

  async query(input: ActionRequestQuery): Promise<ActionRequestQueryResult> {
    return queryActionRequestRecords(await this.list(), input)
  }

  async remove(actionRequestId: string): Promise<void> {
    await rm(getActionRequestFilePath(actionRequestId, this.baseDir), {
      force: true,
    })
  }
}
