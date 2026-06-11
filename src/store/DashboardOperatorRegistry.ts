import { mkdir, readdir, rm, rmdir } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { readJsonFile, writeJsonFile } from '../../runtime/runtime/jsonFile.js'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type DashboardOperatorRole = 'owner' | 'operator' | 'viewer'

// `source` records how the operator was created: 'env' (local-dev bypass) or
// 'siws' (Sign-In With Solana).
export type DashboardOperatorRecord = {
  operatorId: string
  workspaceId: string
  createdAt: string
  updatedAt: string
  displayName: string
  role: DashboardOperatorRole
  status: 'active' | 'disabled'
  source: 'env' | 'siws'
  // SIWS login identity (base58 Solana pubkey); unique per operator. Absent for
  // env operators.
  walletAddress?: string
  email?: string
  lastLoginAt?: string
}

export interface DashboardOperatorRegistry {
  get(operatorId: string): Promise<DashboardOperatorRecord | undefined>
  getByWalletAddress(
    walletAddress: string,
  ): Promise<DashboardOperatorRecord | undefined>
  put(record: DashboardOperatorRecord): Promise<void>
  putIfUpdatedAt(
    record: DashboardOperatorRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean>
  list(): Promise<DashboardOperatorRecord[]>
  remove(operatorId: string): Promise<void>
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getOperatorsDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'dashboard-operators')
}

function getOperatorFilePath(operatorId: string, baseDir?: string): string {
  return join(getOperatorsDir(baseDir), `${operatorId}.json`)
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquireOperatorFileLock(lockDir: string): Promise<void> {
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

export class InMemoryDashboardOperatorRegistry
  implements DashboardOperatorRegistry
{
  private readonly records = new Map<string, DashboardOperatorRecord>()

  constructor(seedRecords: DashboardOperatorRecord[] = []) {
    for (const record of seedRecords) {
      this.records.set(record.operatorId, record)
    }
  }

  async get(operatorId: string): Promise<DashboardOperatorRecord | undefined> {
    return this.records.get(operatorId)
  }

  async getByWalletAddress(
    walletAddress: string,
  ): Promise<DashboardOperatorRecord | undefined> {
    for (const record of this.records.values()) {
      if (record.walletAddress === walletAddress) {
        return record
      }
    }
    return undefined
  }

  async put(record: DashboardOperatorRecord): Promise<void> {
    this.records.set(record.operatorId, record)
  }

  async putIfUpdatedAt(
    record: DashboardOperatorRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    const current = this.records.get(record.operatorId)
    if (current?.updatedAt !== expectedUpdatedAt) {
      return false
    }
    this.records.set(record.operatorId, record)
    return true
  }

  async list(): Promise<DashboardOperatorRecord[]> {
    return [...this.records.values()]
  }

  async remove(operatorId: string): Promise<void> {
    this.records.delete(operatorId)
  }
}

export class FileDashboardOperatorRegistry
  implements DashboardOperatorRegistry
{
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async get(operatorId: string): Promise<DashboardOperatorRecord | undefined> {
    return readJsonFile<DashboardOperatorRecord>(
      getOperatorFilePath(operatorId, this.baseDir),
    )
  }

  async getByWalletAddress(
    walletAddress: string,
  ): Promise<DashboardOperatorRecord | undefined> {
    const records = await this.list()
    return records.find((record) => record.walletAddress === walletAddress)
  }

  async put(record: DashboardOperatorRecord): Promise<void> {
    await mkdir(getOperatorsDir(this.baseDir), { recursive: true })
    await writeJsonFile(getOperatorFilePath(record.operatorId, this.baseDir), record)
  }

  async putIfUpdatedAt(
    record: DashboardOperatorRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    await mkdir(getOperatorsDir(this.baseDir), { recursive: true })
    const lockDir = `${getOperatorFilePath(record.operatorId, this.baseDir)}.lock`
    await acquireOperatorFileLock(lockDir)
    try {
      const current = await this.get(record.operatorId)
      if (current?.updatedAt !== expectedUpdatedAt) {
        return false
      }
      await writeJsonFile(getOperatorFilePath(record.operatorId, this.baseDir), record)
      return true
    } finally {
      await rmdir(lockDir).catch(() => undefined)
    }
  }

  async list(): Promise<DashboardOperatorRecord[]> {
    try {
      const entries = await readdir(getOperatorsDir(this.baseDir), {
        withFileTypes: true,
      })
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<DashboardOperatorRecord>(
              join(getOperatorsDir(this.baseDir), entry.name),
            ),
          ),
      )

      return records.filter(
        (record): record is DashboardOperatorRecord => Boolean(record),
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

  async remove(operatorId: string): Promise<void> {
    await rm(getOperatorFilePath(operatorId, this.baseDir), { force: true })
  }
}
