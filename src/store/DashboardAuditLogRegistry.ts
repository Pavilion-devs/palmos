import { mkdir, readdir, rm } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { DashboardOperatorRole } from './DashboardOperatorRegistry.js'
import { readJsonFile, writeJsonFile } from '../../runtime/runtime/jsonFile.js'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type DashboardAuditAction =
  | 'agent.create'
  | 'agent.policy.update'
  | 'agent.privacy.update'
  | 'agent.settlement.update'
  | 'agent.lifecycle.update'
  | 'workspace.update'
  | 'operator.create'
  | 'operator.update'
  | 'operator.disable'
  | 'operator.enable'
  | 'workspace.export'
  | 'agent.run'
  | 'agent_credential.create'
  | 'agent_credential.update'
  | 'agent_credential.revoke'
  | 'agent_credential.rotate'
  | 'service.register'
  | 'service.verify'
  | 'service.disable'
  | 'service.enable'
  | 'agent.service.allow'
  | 'agent.service.unallow'
  | 'control.dead_man_sweep'
  | 'showcase.run'
  | 'approval.decide'
  | 'storage.maintenance'

export type DashboardAuditTarget = {
  type:
    | 'agent'
    | 'workspace'
    | 'operator'
    | 'agent_credential'
    | 'service'
    | 'paid_call'
    | 'action_request'
    | 'control'
    | 'showcase'
    | 'storage'
  id: string
}

export type DashboardAuditLogRecord = {
  auditLogId: string
  at: string
  workspaceId: string
  actorId: string
  operatorId: string
  operatorRole: DashboardOperatorRole
  source: 'env' | 'judge'
  action: DashboardAuditAction
  status: 'succeeded' | 'failed'
  target?: DashboardAuditTarget
  summary: string
  metadata?: Record<string, unknown>
}

export interface DashboardAuditLogRegistry {
  get(auditLogId: string): Promise<DashboardAuditLogRecord | undefined>
  put(record: DashboardAuditLogRecord): Promise<void>
  list(): Promise<DashboardAuditLogRecord[]>
  prune(input: DashboardAuditPruneInput): Promise<DashboardAuditPruneResult>
  remove(auditLogId: string): Promise<void>
}

export type DashboardAuditPruneInput = {
  maxRecords?: number
  maxAgeMs?: number
  now?: number
}

export type DashboardAuditPruneResult = {
  kept: number
  removed: number
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getAuditLogsDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'dashboard-audit')
}

function getAuditLogFilePath(auditLogId: string, baseDir?: string): string {
  return join(getAuditLogsDir(baseDir), `${auditLogId}.json`)
}

function shouldPruneRecord(input: {
  record: DashboardAuditLogRecord
  index: number
  maxRecords?: number
  maxAgeMs?: number
  now: number
}): boolean {
  if (input.maxRecords != null && input.index >= input.maxRecords) {
    return true
  }

  if (input.maxAgeMs == null) {
    return false
  }

  const at = Date.parse(input.record.at)
  return Number.isFinite(at) && at < input.now - input.maxAgeMs
}

export class InMemoryDashboardAuditLogRegistry
  implements DashboardAuditLogRegistry
{
  private readonly records = new Map<string, DashboardAuditLogRecord>()

  constructor(seedRecords: DashboardAuditLogRecord[] = []) {
    for (const record of seedRecords) {
      this.records.set(record.auditLogId, record)
    }
  }

  async get(auditLogId: string): Promise<DashboardAuditLogRecord | undefined> {
    return this.records.get(auditLogId)
  }

  async put(record: DashboardAuditLogRecord): Promise<void> {
    this.records.set(record.auditLogId, record)
  }

  async list(): Promise<DashboardAuditLogRecord[]> {
    return [...this.records.values()]
  }

  async prune(
    input: DashboardAuditPruneInput,
  ): Promise<DashboardAuditPruneResult> {
    const sorted = (await this.list()).sort((left, right) =>
      right.at.localeCompare(left.at),
    )
    const now = input.now ?? Date.now()
    let removed = 0

    for (const [index, record] of sorted.entries()) {
      if (
        shouldPruneRecord({
          record,
          index,
          maxRecords: input.maxRecords,
          maxAgeMs: input.maxAgeMs,
          now,
        })
      ) {
        this.records.delete(record.auditLogId)
        removed += 1
      }
    }

    return {
      kept: this.records.size,
      removed,
    }
  }

  async remove(auditLogId: string): Promise<void> {
    this.records.delete(auditLogId)
  }
}

export class FileDashboardAuditLogRegistry
  implements DashboardAuditLogRegistry
{
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async get(auditLogId: string): Promise<DashboardAuditLogRecord | undefined> {
    return readJsonFile<DashboardAuditLogRecord>(
      getAuditLogFilePath(auditLogId, this.baseDir),
    )
  }

  async put(record: DashboardAuditLogRecord): Promise<void> {
    await mkdir(getAuditLogsDir(this.baseDir), { recursive: true })
    await writeJsonFile(getAuditLogFilePath(record.auditLogId, this.baseDir), record)
  }

  async list(): Promise<DashboardAuditLogRecord[]> {
    try {
      const entries = await readdir(getAuditLogsDir(this.baseDir), {
        withFileTypes: true,
      })
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<DashboardAuditLogRecord>(
              join(getAuditLogsDir(this.baseDir), entry.name),
            ),
          ),
      )

      return records.filter(
        (record): record is DashboardAuditLogRecord => Boolean(record),
      )
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

  async prune(
    input: DashboardAuditPruneInput,
  ): Promise<DashboardAuditPruneResult> {
    const sorted = (await this.list()).sort((left, right) =>
      right.at.localeCompare(left.at),
    )
    const now = input.now ?? Date.now()
    let removed = 0

    for (const [index, record] of sorted.entries()) {
      if (
        shouldPruneRecord({
          record,
          index,
          maxRecords: input.maxRecords,
          maxAgeMs: input.maxAgeMs,
          now,
        })
      ) {
        await this.remove(record.auditLogId)
        removed += 1
      }
    }

    return {
      kept: sorted.length - removed,
      removed,
    }
  }

  async remove(auditLogId: string): Promise<void> {
    await rm(getAuditLogFilePath(auditLogId, this.baseDir), { force: true })
    await rm(`${getAuditLogFilePath(auditLogId, this.baseDir)}.bak`, {
      force: true,
    })
  }
}
