import type {
  ActionRequestKind,
  ActionRequestRecord,
  ActionRequestStatus,
} from '../store/ActionRequestRegistry.js'
import type { RequestAssetTransferDependencies } from './requestAssetTransfer.js'
import {
  reconcileNativeActionRequests,
  type ReconcileNativeActionRequestsResult,
} from './requestAssetTransfer.js'
import {
  DEFAULT_WALLET_ACTION_STALE_AFTER_MS,
  isReconciledWalletActionKind,
  isWalletActionStale,
  isWalletActionStaleStatus,
  readWalletActionAgeMs,
  RECONCILED_WALLET_ACTION_KINDS,
  WALLET_ACTION_STALE_STATUSES,
} from './walletActionLifecycle.js'

export type ReconcileWalletActionStaleResult = {
  actionRequestId: string
  kind: ActionRequestKind
  previousStatus: ActionRequestStatus
  nextStatus?: ActionRequestStatus
  outcome: 'updated' | 'unchanged' | 'stale' | 'skipped'
  reason:
    | 'stale_timeout'
    | 'within_threshold'
    | 'status_conflict'
    | 'unsupported_kind'
  ageMs?: number
  staleAfterMs: number
}

export type ReconcileWalletActionStaleSummary = {
  checked: number
  updated: number
  unchanged: number
  stale: number
  skipped: number
  results: ReconcileWalletActionStaleResult[]
}

export type ReconcileWalletActionsResult = {
  generatedAt: string
  transferLifecycle: ReconcileNativeActionRequestsResult
  staleWalletActions: ReconcileWalletActionStaleSummary
}

function nowIso(
  deps: Pick<RequestAssetTransferDependencies, 'now'>,
): string {
  return deps.now?.() ?? new Date().toISOString()
}

function buildStaleWalletActionFailure(input: {
  record: ActionRequestRecord
  at: string
  staleAfterMs: number
}): ActionRequestRecord {
  return {
    ...input.record,
    updatedAt: input.at,
    status: 'failed',
    requestContext: {
      ...input.record.requestContext,
      staleLifecycleDetectedAt: input.at,
      staleLifecycleTimeoutMs: input.staleAfterMs,
    },
    errorCode: input.record.errorCode ?? 'action.lifecycle_timeout',
    errorMessage:
      input.record.errorMessage ??
      `Wallet action ${input.record.kind} remained in ${input.record.status} longer than ${input.staleAfterMs}ms.`,
  }
}

async function listStaleCandidateWalletActions(input: {
  deps: Pick<RequestAssetTransferDependencies, 'actionRequests'>
}): Promise<ActionRequestRecord[]> {
  const records = new Map<string, ActionRequestRecord>()

  for (const kind of RECONCILED_WALLET_ACTION_KINDS) {
    for (const status of WALLET_ACTION_STALE_STATUSES) {
      const query = await input.deps.actionRequests.query({
        kind,
        status,
        limit: 500,
      })
      for (const record of query.records) {
        records.set(record.actionRequestId, record)
      }
    }
  }

  return [...records.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.actionRequestId.localeCompare(left.actionRequestId),
  )
}

async function reconcileStaleWalletActions(
  deps: Pick<RequestAssetTransferDependencies, 'actionRequests' | 'now'>,
  input: {
    dryRun?: boolean
    staleAfterMs?: number
  } = {},
): Promise<ReconcileWalletActionStaleSummary> {
  const staleAfterMs =
    input.staleAfterMs ?? DEFAULT_WALLET_ACTION_STALE_AFTER_MS
  const at = nowIso(deps)
  const candidates = await listStaleCandidateWalletActions({ deps })
  const results: ReconcileWalletActionStaleResult[] = []
  let updated = 0
  let unchanged = 0
  let stale = 0
  let skipped = 0

  for (const record of candidates) {
    if (!isReconciledWalletActionKind(record.kind)) {
      skipped += 1
      results.push({
        actionRequestId: record.actionRequestId,
        kind: record.kind,
        previousStatus: record.status,
        nextStatus: record.status,
        outcome: 'skipped',
        reason: 'unsupported_kind',
        staleAfterMs,
      })
      continue
    }

    if (!isWalletActionStaleStatus(record.status)) {
      skipped += 1
      results.push({
        actionRequestId: record.actionRequestId,
        kind: record.kind,
        previousStatus: record.status,
        nextStatus: record.status,
        outcome: 'skipped',
        reason: 'within_threshold',
        staleAfterMs,
      })
      continue
    }

    const ageMs = readWalletActionAgeMs({
      record,
      now: at,
    })
    const isStale = isWalletActionStale({
      record,
      now: at,
      staleAfterMs,
    })

    if (!isStale) {
      unchanged += 1
      results.push({
        actionRequestId: record.actionRequestId,
        kind: record.kind,
        previousStatus: record.status,
        nextStatus: record.status,
        outcome: 'unchanged',
        reason: 'within_threshold',
        ageMs,
        staleAfterMs,
      })
      continue
    }

    stale += 1
    if (
      (record.kind !== 'wallet.policy_update' && record.kind !== 'wallet.create') ||
      input.dryRun
    ) {
      results.push({
        actionRequestId: record.actionRequestId,
        kind: record.kind,
        previousStatus: record.status,
        nextStatus: record.status,
        outcome: 'stale',
        reason: 'stale_timeout',
        ageMs,
        staleAfterMs,
      })
      continue
    }

    const failedRecord = buildStaleWalletActionFailure({
      record,
      at,
      staleAfterMs,
    })
    const claimed = await deps.actionRequests.putIfStatus(
      failedRecord,
      record.status,
    )
    if (!claimed) {
      skipped += 1
      results.push({
        actionRequestId: record.actionRequestId,
        kind: record.kind,
        previousStatus: record.status,
        nextStatus: 'failed',
        outcome: 'skipped',
        reason: 'status_conflict',
        ageMs,
        staleAfterMs,
      })
      continue
    }

    updated += 1
    results.push({
      actionRequestId: record.actionRequestId,
      kind: record.kind,
      previousStatus: record.status,
      nextStatus: 'failed',
      outcome: 'updated',
      reason: 'stale_timeout',
      ageMs,
      staleAfterMs,
    })
  }

  return {
    checked: candidates.length,
    updated,
    unchanged,
    stale,
    skipped,
    results,
  }
}

export async function reconcileWalletActions(
  deps: RequestAssetTransferDependencies,
  input: {
    dryRun?: boolean
    limitPerStatus?: number
    staleAfterMs?: number
  } = {},
): Promise<ReconcileWalletActionsResult> {
  const generatedAt = nowIso(deps)
  const transferLifecycle = await reconcileNativeActionRequests(deps, {
    dryRun: input.dryRun,
    limitPerStatus: input.limitPerStatus,
  })
  const staleWalletActions = await reconcileStaleWalletActions(deps, {
    dryRun: input.dryRun,
    staleAfterMs: input.staleAfterMs,
  })

  return {
    generatedAt,
    transferLifecycle,
    staleWalletActions,
  }
}
