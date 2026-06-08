import { mkdir, readdir, rm, rmdir } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { readJsonFile, writeJsonFile } from '../../runtime/runtime/jsonFile.js'
import type { AgentSettlementMode } from './AgentRegistry.js'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type DashboardWorkspaceSettings = {
  defaultPolicyTemplateId?: string
  defaultApprovalRoute?: string
  defaultSettlementMode?: AgentSettlementMode
  sdkApiBaseUrl?: string
  frontendOrigin?: string
}

export type DashboardWorkspaceRecord = {
  workspaceId: string
  createdAt: string
  updatedAt: string
  displayName: string
  status: 'active' | 'disabled'
  settings: DashboardWorkspaceSettings
}

export interface DashboardWorkspaceRegistry {
  get(workspaceId: string): Promise<DashboardWorkspaceRecord | undefined>
  put(record: DashboardWorkspaceRecord): Promise<void>
  putIfUpdatedAt(
    record: DashboardWorkspaceRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean>
  list(): Promise<DashboardWorkspaceRecord[]>
  remove(workspaceId: string): Promise<void>
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getWorkspacesDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'dashboard-workspaces')
}

function getWorkspaceFilePath(workspaceId: string, baseDir?: string): string {
  return join(getWorkspacesDir(baseDir), `${workspaceId}.json`)
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquireWorkspaceFileLock(lockDir: string): Promise<void> {
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

export class InMemoryDashboardWorkspaceRegistry
  implements DashboardWorkspaceRegistry
{
  private readonly records = new Map<string, DashboardWorkspaceRecord>()

  constructor(seedRecords: DashboardWorkspaceRecord[] = []) {
    for (const record of seedRecords) {
      this.records.set(record.workspaceId, record)
    }
  }

  async get(workspaceId: string): Promise<DashboardWorkspaceRecord | undefined> {
    return this.records.get(workspaceId)
  }

  async put(record: DashboardWorkspaceRecord): Promise<void> {
    this.records.set(record.workspaceId, record)
  }

  async putIfUpdatedAt(
    record: DashboardWorkspaceRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    const current = this.records.get(record.workspaceId)
    if (current?.updatedAt !== expectedUpdatedAt) {
      return false
    }
    this.records.set(record.workspaceId, record)
    return true
  }

  async list(): Promise<DashboardWorkspaceRecord[]> {
    return [...this.records.values()]
  }

  async remove(workspaceId: string): Promise<void> {
    this.records.delete(workspaceId)
  }
}

export class FileDashboardWorkspaceRegistry
  implements DashboardWorkspaceRegistry
{
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async get(workspaceId: string): Promise<DashboardWorkspaceRecord | undefined> {
    return readJsonFile<DashboardWorkspaceRecord>(
      getWorkspaceFilePath(workspaceId, this.baseDir),
    )
  }

  async put(record: DashboardWorkspaceRecord): Promise<void> {
    await mkdir(getWorkspacesDir(this.baseDir), { recursive: true })
    await writeJsonFile(
      getWorkspaceFilePath(record.workspaceId, this.baseDir),
      record,
    )
  }

  async putIfUpdatedAt(
    record: DashboardWorkspaceRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    await mkdir(getWorkspacesDir(this.baseDir), { recursive: true })
    const lockDir = `${getWorkspaceFilePath(record.workspaceId, this.baseDir)}.lock`
    await acquireWorkspaceFileLock(lockDir)
    try {
      const current = await this.get(record.workspaceId)
      if (current?.updatedAt !== expectedUpdatedAt) {
        return false
      }
      await writeJsonFile(
        getWorkspaceFilePath(record.workspaceId, this.baseDir),
        record,
      )
      return true
    } finally {
      await rmdir(lockDir).catch(() => undefined)
    }
  }

  async list(): Promise<DashboardWorkspaceRecord[]> {
    try {
      const entries = await readdir(getWorkspacesDir(this.baseDir), {
        withFileTypes: true,
      })
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<DashboardWorkspaceRecord>(
              join(getWorkspacesDir(this.baseDir), entry.name),
            ),
          ),
      )

      return records.filter(
        (record): record is DashboardWorkspaceRecord => Boolean(record),
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

  async remove(workspaceId: string): Promise<void> {
    await rm(getWorkspaceFilePath(workspaceId, this.baseDir), { force: true })
  }
}
