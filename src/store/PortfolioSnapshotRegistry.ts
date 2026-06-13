import { mkdir, readdir } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { readJsonFile, writeJsonFile } from '../../runtime/runtime/jsonFile.js'
import type { PortfolioSyncStatus } from '../integrations/portfolio/types.js'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

// A point-in-time, persisted copy of a wallet portfolio. Snapshots are an
// additive history/audit layer: the live portfolio is still read on demand
// through the PortfolioReader, but each capture freezes balances/positions and
// their totals so we can show history and reconstruct "what did this wallet
// hold at time T". Transactions stay live and are deliberately not stored here.
export type PortfolioSnapshotPosition = {
  symbol?: string
  chainId?: string
  quantity?: number
  value?: number
}

export type PortfolioSnapshotRecord = {
  snapshotId: string
  agentId: string
  walletId?: string
  address: string
  chainId?: string
  capturedAt: string
  totalValueUsd: number
  valuationComplete?: boolean
  positionsCount: number
  positions: PortfolioSnapshotPosition[]
  syncKind: PortfolioSyncStatus['kind']
  syncMessage: string
}

export interface PortfolioSnapshotRegistry {
  get(snapshotId: string): Promise<PortfolioSnapshotRecord | undefined>
  put(record: PortfolioSnapshotRecord): Promise<void>
  listByAgent(
    agentId: string,
    options?: { limit?: number },
  ): Promise<PortfolioSnapshotRecord[]>
  latestForAgent(agentId: string): Promise<PortfolioSnapshotRecord | undefined>
}

const REQUIRED_VALUATION_SYMBOLS = new Set(['SOL', 'USDC', 'PUSD'])

export function isReliablePortfolioSnapshotRecord(
  record: PortfolioSnapshotRecord,
): boolean {
  if (record.syncKind !== 'synced') {
    return false
  }
  if (record.valuationComplete === false) {
    return false
  }
  if (record.valuationComplete === true) {
    return true
  }
  return !record.positions.some((position) => {
    if (
      !position.symbol ||
      !REQUIRED_VALUATION_SYMBOLS.has(position.symbol) ||
      typeof position.quantity !== 'number' ||
      position.quantity <= 0
    ) {
      return false
    }
    return (
      typeof position.value !== 'number' || !Number.isFinite(position.value)
    )
  })
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getPortfolioSnapshotsDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'portfolio-snapshots')
}

function getPortfolioSnapshotFilePath(
  snapshotId: string,
  baseDir?: string,
): string {
  return join(getPortfolioSnapshotsDir(baseDir), `${snapshotId}.json`)
}

function sortPortfolioSnapshotsByRecency(
  left: PortfolioSnapshotRecord,
  right: PortfolioSnapshotRecord,
): number {
  return (
    right.capturedAt.localeCompare(left.capturedAt) ||
    right.snapshotId.localeCompare(left.snapshotId)
  )
}

function selectAgentSnapshots(
  records: PortfolioSnapshotRecord[],
  agentId: string,
  options?: { limit?: number },
): PortfolioSnapshotRecord[] {
  const filtered = records
    .filter((record) => record.agentId === agentId)
    .sort(sortPortfolioSnapshotsByRecency)

  return options?.limit == null
    ? filtered
    : filtered.slice(0, Math.max(0, options.limit))
}

export class InMemoryPortfolioSnapshotRegistry
  implements PortfolioSnapshotRegistry
{
  private readonly records = new Map<string, PortfolioSnapshotRecord>()

  constructor(seedRecords: PortfolioSnapshotRecord[] = []) {
    for (const record of seedRecords) {
      this.records.set(record.snapshotId, record)
    }
  }

  async get(snapshotId: string): Promise<PortfolioSnapshotRecord | undefined> {
    return this.records.get(snapshotId)
  }

  async put(record: PortfolioSnapshotRecord): Promise<void> {
    this.records.set(record.snapshotId, record)
  }

  async listByAgent(
    agentId: string,
    options?: { limit?: number },
  ): Promise<PortfolioSnapshotRecord[]> {
    return selectAgentSnapshots([...this.records.values()], agentId, options)
  }

  async latestForAgent(
    agentId: string,
  ): Promise<PortfolioSnapshotRecord | undefined> {
    return selectAgentSnapshots([...this.records.values()], agentId, {
      limit: 1,
    })[0]
  }
}

export class FilePortfolioSnapshotRegistry
  implements PortfolioSnapshotRegistry
{
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async get(snapshotId: string): Promise<PortfolioSnapshotRecord | undefined> {
    return readJsonFile<PortfolioSnapshotRecord>(
      getPortfolioSnapshotFilePath(snapshotId, this.baseDir),
    )
  }

  async put(record: PortfolioSnapshotRecord): Promise<void> {
    await mkdir(getPortfolioSnapshotsDir(this.baseDir), { recursive: true })
    await writeJsonFile(
      getPortfolioSnapshotFilePath(record.snapshotId, this.baseDir),
      record,
    )
  }

  async listByAgent(
    agentId: string,
    options?: { limit?: number },
  ): Promise<PortfolioSnapshotRecord[]> {
    return selectAgentSnapshots(await this.list(), agentId, options)
  }

  async latestForAgent(
    agentId: string,
  ): Promise<PortfolioSnapshotRecord | undefined> {
    return selectAgentSnapshots(await this.list(), agentId, { limit: 1 })[0]
  }

  private async list(): Promise<PortfolioSnapshotRecord[]> {
    try {
      const entries = await readdir(getPortfolioSnapshotsDir(this.baseDir), {
        withFileTypes: true,
      })
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<PortfolioSnapshotRecord>(
              join(getPortfolioSnapshotsDir(this.baseDir), entry.name),
            ),
          ),
      )

      return records.filter(
        (record): record is PortfolioSnapshotRecord => Boolean(record),
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
}
