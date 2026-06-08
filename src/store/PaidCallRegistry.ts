import { mkdir, readdir, rm, rmdir } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { readJsonFile, writeJsonFile } from '../../runtime/runtime/jsonFile.js'
import type { AgentSettlementMode } from './AgentRegistry.js'
import {
  FileActionRequestRegistry,
  InMemoryActionRequestRegistry,
  type ActionRequestRegistry,
  type ActionRequestSource,
} from './ActionRequestRegistry.js'
import {
  mirrorPaidCallRecord,
  removeMirroredActionRequest,
} from './paidCallActionRequestMirror.js'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type PaidCallStatus =
  | 'blocked'
  | 'approval_pending'
  | 'waiting_for_execution'
  | 'executed'
  | 'failed'

export type UmbraSettlementMetadata = {
  settlementRail: 'umbra'
  privacyPath:
    | 'umbra_direct_deposit'
    | 'umbra_mixer_utxo'
    | 'local_mock'
    | 'transparent_disabled'
  network: 'solana-devnet' | 'solana-mainnet' | 'solana-local' | string
  assetSymbol: 'wSOL' | 'dUSDC' | 'dUSDT' | 'PUSD' | string
  mint: string
  amount: string
  finalTransactionSignature?: string
  fundingTransactionSignatures?: string[]
  createUtxoTransactionSignatures?: string[]
  claimTransactionSignatures?: string[]
  reportId?: string
  reconciliationStatus?: 'matched' | 'unmatched' | 'pending' | 'failed'
  disclosurePosture?: 'artifact_only' | 'viewing_key_available' | 'not_supported'
}

export type PaidCallPaymentRail = 'x402' | 'palmos-pusd' | 'umbra'
export type PaidCallSettlementMode = AgentSettlementMode | 'umbra'

export type PaidCallSettlementRecord = {
  rail: PaidCallPaymentRail
  mode?: PaidCallSettlementMode | 'x402'
  source:
    | 'local-demo'
    | 'real-solana'
    | 'ows'
    | 'x402'
    | 'umbra'
    | 'unknown'
  amount: string
  assetSymbol: string
  network?: string
  mint?: string
  payer?: string
  payerTokenAccount?: string
  recipient?: string
  recipientTokenAccount?: string
  reference?: string
  signature?: string
  explorerUrl?: string
  confirmationStatus:
    | 'not_applicable'
    | 'pending'
    | 'confirmed'
    | 'failed'
    | 'unknown'
  confirmedAt?: string
  reconciliationStatus?:
    | 'matched'
    | 'pending'
    | 'failed'
    | 'not_applicable'
    | 'not_supported'
  reconciledAt?: string
  reconciliationError?: string
}

export type PaidCallRecord = {
  executionId: string
  createdAt: string
  updatedAt: string
  agentId: string
  serviceId: string
  vendorId: string
  paymentRail: PaidCallPaymentRail
  settlementMode?: PaidCallSettlementMode
  amount: string
  assetSymbol: string
  chainId?: string
  transactionSignature?: string
  transactionExplorerUrl?: string
  settlement?: PaidCallSettlementRecord
  umbraSettlement?: UmbraSettlementMetadata
  status: PaidCallStatus
  runId?: string
  sessionId?: string
  walletId?: string
  runtimeStatus?: string
  runtimePhase?: string
  requestSource?: ActionRequestSource
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
  putIfStatus(
    record: PaidCallRecord,
    expectedStatus: PaidCallStatus,
  ): Promise<boolean>
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

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquirePaidCallFileLock(lockDir: string): Promise<void> {
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

export class InMemoryPaidCallRegistry implements PaidCallRegistry {
  private readonly records = new Map<string, PaidCallRecord>()
  private readonly actionRequests: ActionRequestRegistry

  constructor(
    seedRecords: PaidCallRecord[] = [],
    actionRequests: ActionRequestRegistry = new InMemoryActionRequestRegistry(),
  ) {
    this.actionRequests = actionRequests
    for (const record of seedRecords) {
      this.records.set(record.executionId, record)
    }
  }

  async get(executionId: string): Promise<PaidCallRecord | undefined> {
    return this.records.get(executionId)
  }

  async put(record: PaidCallRecord): Promise<void> {
    this.records.set(record.executionId, record)
    await mirrorPaidCallRecord(this.actionRequests, record)
  }

  async putIfStatus(
    record: PaidCallRecord,
    expectedStatus: PaidCallStatus,
  ): Promise<boolean> {
    const current = this.records.get(record.executionId)
    if (current?.status !== expectedStatus) {
      return false
    }
    this.records.set(record.executionId, record)
    await mirrorPaidCallRecord(this.actionRequests, record)
    return true
  }

  async list(): Promise<PaidCallRecord[]> {
    return [...this.records.values()]
  }

  async remove(executionId: string): Promise<void> {
    this.records.delete(executionId)
    await removeMirroredActionRequest(this.actionRequests, executionId)
  }
}

export class FilePaidCallRegistry implements PaidCallRegistry {
  private readonly baseDir: string
  private readonly actionRequests: ActionRequestRegistry

  constructor(
    baseDir?: string,
    actionRequests?: ActionRequestRegistry,
  ) {
    this.baseDir = resolveBaseDir(baseDir)
    this.actionRequests =
      actionRequests ?? new FileActionRequestRegistry(this.baseDir)
  }

  async get(executionId: string): Promise<PaidCallRecord | undefined> {
    return readJsonFile<PaidCallRecord>(
      getPaidCallFilePath(executionId, this.baseDir),
    )
  }

  async put(record: PaidCallRecord): Promise<void> {
    await mkdir(getPaidCallsDir(this.baseDir), { recursive: true })
    await writeJsonFile(getPaidCallFilePath(record.executionId, this.baseDir), record)
    await this.tryMirror(record)
  }

  async putIfStatus(
    record: PaidCallRecord,
    expectedStatus: PaidCallStatus,
  ): Promise<boolean> {
    await mkdir(getPaidCallsDir(this.baseDir), { recursive: true })
    const lockDir = `${getPaidCallFilePath(record.executionId, this.baseDir)}.lock`
    await acquirePaidCallFileLock(lockDir)
    try {
      const current = await this.get(record.executionId)
      if (current?.status !== expectedStatus) {
        return false
      }
      await writeJsonFile(getPaidCallFilePath(record.executionId, this.baseDir), record)
      await this.tryMirror(record)
      return true
    } finally {
      await rmdir(lockDir).catch(() => undefined)
    }
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
    try {
      await removeMirroredActionRequest(this.actionRequests, executionId)
    } catch {
      // File-backed ActionRequest data is shadow state. Drift is repaired by reconciliation.
    }
  }

  private async tryMirror(record: PaidCallRecord): Promise<void> {
    try {
      await mirrorPaidCallRecord(this.actionRequests, record)
    } catch {
      // File-backed ActionRequest data is shadow state. Drift is repaired by reconciliation.
    }
  }
}
