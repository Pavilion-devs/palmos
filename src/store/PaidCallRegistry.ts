import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { AgentSettlementMode } from './AgentRegistry.js'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type PaidCallStatus =
  | 'blocked'
  | 'approval_pending'
  | 'waiting_for_execution'
  | 'executed'
  | 'failed'

export type PaidCallPaymentRail = 'x402' | 'palmos-pusd'

export type PaidCallRecord = {
  executionId: string
  createdAt: string
  updatedAt: string
  agentId: string
  serviceId: string
  vendorId: string
  paymentRail: PaidCallPaymentRail
  settlementMode?: AgentSettlementMode
  amount: string
  assetSymbol: string
  chainId?: string
  transactionSignature?: string
  transactionExplorerUrl?: string
  status: PaidCallStatus
  runId?: string
  sessionId?: string
  walletId?: string
  runtimeStatus?: string
  runtimePhase?: string
  requestPayload: Record<string, unknown>
  requestSummary: Record<string, unknown>
  requestUrl?: string
  responseStatus?: number
  responseHeaders?: Record<string, string>
  responsePreview?: unknown
  errorCode?: string
  errorMessage?: string
}

export interface PaidCallRegistry {
  get(executionId: string): Promise<PaidCallRecord | undefined>
  put(record: PaidCallRecord): Promise<void>
  list(): Promise<PaidCallRecord[]>
  remove(executionId: string): Promise<void>
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getPaidCallsDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'paid-calls')
}

function getPaidCallFilePath(executionId: string, baseDir?: string): string {
  return join(getPaidCallsDir(baseDir), `${executionId}.json`)
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const contents = await readFile(path, 'utf8')
    return JSON.parse(contents) as T
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined
    }

    throw error
  }
}

export class InMemoryPaidCallRegistry implements PaidCallRegistry {
  private readonly records = new Map<string, PaidCallRecord>()

  constructor(seedRecords: PaidCallRecord[] = []) {
    for (const record of seedRecords) {
      this.records.set(record.executionId, record)
    }
  }

  async get(executionId: string): Promise<PaidCallRecord | undefined> {
    return this.records.get(executionId)
  }

  async put(record: PaidCallRecord): Promise<void> {
    this.records.set(record.executionId, record)
  }

  async list(): Promise<PaidCallRecord[]> {
    return [...this.records.values()]
  }

  async remove(executionId: string): Promise<void> {
    this.records.delete(executionId)
  }
}

export class FilePaidCallRegistry implements PaidCallRegistry {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async get(executionId: string): Promise<PaidCallRecord | undefined> {
    return readJsonFile<PaidCallRecord>(
      getPaidCallFilePath(executionId, this.baseDir),
    )
  }

  async put(record: PaidCallRecord): Promise<void> {
    await mkdir(getPaidCallsDir(this.baseDir), { recursive: true })
    await writeFile(
      getPaidCallFilePath(record.executionId, this.baseDir),
      JSON.stringify(record, null, 2),
      'utf8',
    )
  }

  async list(): Promise<PaidCallRecord[]> {
    try {
      const entries = await readdir(getPaidCallsDir(this.baseDir), {
        withFileTypes: true,
      })
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<PaidCallRecord>(
              join(getPaidCallsDir(this.baseDir), entry.name),
            ),
          ),
      )

      return records.filter((record): record is PaidCallRecord => Boolean(record))
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

  async remove(executionId: string): Promise<void> {
    await rm(getPaidCallFilePath(executionId, this.baseDir), { force: true })
  }
}
