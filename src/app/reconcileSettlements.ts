import { Connection } from '@solana/web3.js'
import { readSolanaRpcUrlFromEnv } from '../integrations/pusd/constants.js'
import type {
  PaidCallRecord,
  PaidCallRegistry,
  PaidCallSettlementRecord,
} from '../store/PaidCallRegistry.js'
import { buildSolscanTransactionUrl } from './settlementRecords.js'

export type SettlementVerificationResult = {
  confirmationStatus: PaidCallSettlementRecord['confirmationStatus']
  signature?: string
  explorerUrl?: string
  confirmedAt?: string
  error?: string
}

export type SettlementVerifier = (
  settlement: PaidCallSettlementRecord,
  execution: PaidCallRecord,
) => Promise<SettlementVerificationResult>

export type SettlementReconciliationResult = {
  executionId: string
  changed: boolean
  skipped: boolean
  reason:
    | 'reconciled'
    | 'local_demo'
    | 'missing_settlement'
    | 'missing_signature'
    | 'unsupported_rail'
    | 'not_executed'
  record: PaidCallRecord
}

function sameSettlement(
  left: PaidCallSettlementRecord,
  right: PaidCallSettlementRecord,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function buildLocalDemoSettlement(
  settlement: PaidCallSettlementRecord,
  checkedAt: string,
): PaidCallSettlementRecord {
  return {
    ...settlement,
    confirmationStatus: 'not_applicable',
    reconciliationStatus: 'not_applicable',
    reconciledAt: checkedAt,
    reconciliationError: undefined,
  }
}

function buildPendingSettlement(
  settlement: PaidCallSettlementRecord,
  checkedAt: string,
  error?: string,
): PaidCallSettlementRecord {
  return {
    ...settlement,
    confirmationStatus:
      settlement.confirmationStatus === 'confirmed'
        ? 'confirmed'
        : settlement.confirmationStatus === 'failed'
          ? 'failed'
          : 'pending',
    reconciliationStatus: 'pending',
    reconciledAt: checkedAt,
    reconciliationError: error,
  }
}

function buildUnsupportedSettlement(
  settlement: PaidCallSettlementRecord,
  checkedAt: string,
): PaidCallSettlementRecord {
  return {
    ...settlement,
    reconciliationStatus: 'not_supported',
    reconciledAt: checkedAt,
    reconciliationError: undefined,
  }
}

function buildVerifiedSettlement(input: {
  settlement: PaidCallSettlementRecord
  verification: SettlementVerificationResult
  checkedAt: string
}): PaidCallSettlementRecord {
  const reconciliationStatus =
    input.verification.confirmationStatus === 'confirmed'
      ? 'matched'
      : input.verification.confirmationStatus === 'failed'
        ? 'failed'
        : 'pending'

  return {
    ...input.settlement,
    signature: input.verification.signature ?? input.settlement.signature,
    explorerUrl:
      input.verification.explorerUrl ?? input.settlement.explorerUrl,
    confirmationStatus: input.verification.confirmationStatus,
    confirmedAt:
      input.verification.confirmationStatus === 'confirmed'
        ? input.verification.confirmedAt ??
          input.settlement.confirmedAt ??
          input.checkedAt
        : input.settlement.confirmedAt,
    reconciliationStatus,
    reconciledAt: input.checkedAt,
    reconciliationError: input.verification.error,
  }
}

async function putIfChanged(input: {
  registry?: PaidCallRegistry
  record: PaidCallRecord
  settlement: PaidCallSettlementRecord
  checkedAt: string
  reason: SettlementReconciliationResult['reason']
  skipped: boolean
}): Promise<SettlementReconciliationResult> {
  const changed =
    !input.record.settlement ||
    !sameSettlement(input.record.settlement, input.settlement)
  const record = changed
    ? {
        ...input.record,
        updatedAt: input.checkedAt,
        settlement: input.settlement,
        transactionSignature:
          input.settlement.signature ?? input.record.transactionSignature,
        transactionExplorerUrl:
          input.settlement.explorerUrl ?? input.record.transactionExplorerUrl,
      }
    : input.record

  if (changed) {
    await input.registry?.put(record)
  }

  return {
    executionId: record.executionId,
    changed,
    skipped: input.skipped,
    reason: input.reason,
    record,
  }
}

export async function reconcilePaidCallSettlement(input: {
  record: PaidCallRecord
  registry?: PaidCallRegistry
  verifier?: SettlementVerifier
  now?: () => string
}): Promise<SettlementReconciliationResult> {
  const checkedAt = input.now?.() ?? new Date().toISOString()
  const settlement = input.record.settlement

  if (input.record.status !== 'executed') {
    return {
      executionId: input.record.executionId,
      changed: false,
      skipped: true,
      reason: 'not_executed',
      record: input.record,
    }
  }

  if (!settlement) {
    return {
      executionId: input.record.executionId,
      changed: false,
      skipped: true,
      reason: 'missing_settlement',
      record: input.record,
    }
  }

  if (settlement.source === 'local-demo') {
    return putIfChanged({
      registry: input.registry,
      record: input.record,
      settlement: buildLocalDemoSettlement(settlement, checkedAt),
      checkedAt,
      reason: 'local_demo',
      skipped: true,
    })
  }

  if (settlement.rail === 'umbra') {
    return putIfChanged({
      registry: input.registry,
      record: input.record,
      settlement: buildUnsupportedSettlement(settlement, checkedAt),
      checkedAt,
      reason: 'unsupported_rail',
      skipped: true,
    })
  }

  if (!settlement.signature) {
    return putIfChanged({
      registry: input.registry,
      record: input.record,
      settlement: buildPendingSettlement(
        settlement,
        checkedAt,
        'Settlement has no transaction signature yet.',
      ),
      checkedAt,
      reason: 'missing_signature',
      skipped: true,
    })
  }

  if (!input.verifier) {
    return putIfChanged({
      registry: input.registry,
      record: input.record,
      settlement: buildPendingSettlement(settlement, checkedAt),
      checkedAt,
      reason: 'unsupported_rail',
      skipped: true,
    })
  }

  const verification = await input.verifier(settlement, input.record)
  return putIfChanged({
    registry: input.registry,
    record: input.record,
    settlement: buildVerifiedSettlement({
      settlement,
      verification,
      checkedAt,
    }),
    checkedAt,
    reason: 'reconciled',
    skipped: false,
  })
}

export async function reconcilePaidCallSettlements(input: {
  registry: PaidCallRegistry
  verifier?: SettlementVerifier
  now?: () => string
}): Promise<{
  checked: number
  changed: number
  skipped: number
  results: SettlementReconciliationResult[]
}> {
  const records = await input.registry.list()
  const results = await Promise.all(
    records.map((record) =>
      reconcilePaidCallSettlement({
        record,
        registry: input.registry,
        verifier: input.verifier,
        now: input.now,
      }),
    ),
  )

  return {
    checked: results.length,
    changed: results.filter((result) => result.changed).length,
    skipped: results.filter((result) => result.skipped).length,
    results,
  }
}

export function createSolanaSettlementVerifier(input?: {
  rpcUrl?: string
  env?: Record<string, string | undefined>
}): SettlementVerifier {
  const connection = new Connection(
    input?.rpcUrl ?? readSolanaRpcUrlFromEnv(input?.env),
    'confirmed',
  )

  return async (settlement) => {
    if (!settlement.signature) {
      return {
        confirmationStatus: 'pending',
        error: 'Settlement has no transaction signature yet.',
      }
    }

    const status = await connection.getSignatureStatus(settlement.signature, {
      searchTransactionHistory: true,
    })
    if (!status.value) {
      return {
        confirmationStatus: 'pending',
        signature: settlement.signature,
        explorerUrl:
          settlement.explorerUrl ??
          buildSolscanTransactionUrl(settlement.signature, settlement.network),
      }
    }
    if (status.value.err) {
      return {
        confirmationStatus: 'failed',
        signature: settlement.signature,
        explorerUrl:
          settlement.explorerUrl ??
          buildSolscanTransactionUrl(settlement.signature, settlement.network),
        error: JSON.stringify(status.value.err),
      }
    }

    return {
      confirmationStatus:
        status.value.confirmationStatus === 'processed' ? 'pending' : 'confirmed',
      signature: settlement.signature,
      explorerUrl:
        settlement.explorerUrl ??
        buildSolscanTransactionUrl(settlement.signature, settlement.network),
    }
  }
}
