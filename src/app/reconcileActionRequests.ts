import type {
  ActionRequestRecord,
  ActionRequestRegistry,
} from '../store/ActionRequestRegistry.js'
import type { PaidCallRegistry } from '../store/PaidCallRegistry.js'
import { mapPaidCallToActionRequest } from '../store/mapPaidCallToActionRequest.js'

export type ActionRequestMirrorReconcileResult = {
  actionRequestId: string
  executionId?: string
  outcome: 'created' | 'updated' | 'unchanged' | 'deleted' | 'skipped'
  reason:
    | 'paid_call_backfill'
    | 'paid_call_reconciled'
    | 'paid_call_in_sync'
    | 'orphan_paid_call_shadow'
    | 'orphan_non_legacy'
  source?: ActionRequestRecord['source']
  status?: ActionRequestRecord['status']
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }

  if (!value || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`
}

function sameActionRequest(
  left: ActionRequestRecord | undefined,
  right: ActionRequestRecord,
): boolean {
  return left != null && stableJson(left) === stableJson(right)
}

function isPaidCallShadowActionRequest(record: ActionRequestRecord): boolean {
  return (
    record.requestContext?.['legacyRecordType'] === 'PaidCall' &&
    record.kind === 'service.pay'
  )
}

export async function reconcilePaidCallActionRequests(input: {
  paidCalls: PaidCallRegistry
  actionRequests: ActionRequestRegistry
  dryRun?: boolean
  removeOrphanMirrors?: boolean
}): Promise<{
  checkedPaidCalls: number
  checkedActionRequests: number
  created: number
  updated: number
  deleted: number
  unchanged: number
  skipped: number
  results: ActionRequestMirrorReconcileResult[]
}> {
  const [paidCalls, actionRequests] = await Promise.all([
    input.paidCalls.list(),
    input.actionRequests.list(),
  ])
  const paidCallsById = new Map(
    paidCalls.map((record) => [record.executionId, record] as const),
  )
  const actionRequestsById = new Map(
    actionRequests.map((record) => [record.actionRequestId, record] as const),
  )

  const results: ActionRequestMirrorReconcileResult[] = []
  let created = 0
  let updated = 0
  let deleted = 0
  let unchanged = 0
  let skipped = 0

  for (const paidCall of paidCalls) {
    const current = actionRequestsById.get(paidCall.executionId)
    const expected = mapPaidCallToActionRequest(paidCall, current)

    if (!current) {
      created += 1
      if (!input.dryRun) {
        await input.actionRequests.put(expected)
      }
      results.push({
        actionRequestId: expected.actionRequestId,
        executionId: paidCall.executionId,
        outcome: 'created',
        reason: 'paid_call_backfill',
        source: expected.source,
        status: expected.status,
      })
      continue
    }

    if (sameActionRequest(current, expected)) {
      unchanged += 1
      results.push({
        actionRequestId: current.actionRequestId,
        executionId: paidCall.executionId,
        outcome: 'unchanged',
        reason: 'paid_call_in_sync',
        source: current.source,
        status: current.status,
      })
      continue
    }

    updated += 1
    if (!input.dryRun) {
      await input.actionRequests.put(expected)
    }
    results.push({
      actionRequestId: expected.actionRequestId,
      executionId: paidCall.executionId,
      outcome: 'updated',
      reason: 'paid_call_reconciled',
      source: expected.source,
      status: expected.status,
    })
  }

  for (const actionRequest of actionRequests) {
    if (paidCallsById.has(actionRequest.actionRequestId)) {
      continue
    }

    if (!isPaidCallShadowActionRequest(actionRequest)) {
      skipped += 1
      results.push({
        actionRequestId: actionRequest.actionRequestId,
        outcome: 'skipped',
        reason: 'orphan_non_legacy',
        source: actionRequest.source,
        status: actionRequest.status,
      })
      continue
    }

    if (input.removeOrphanMirrors === false) {
      skipped += 1
      results.push({
        actionRequestId: actionRequest.actionRequestId,
        outcome: 'skipped',
        reason: 'orphan_paid_call_shadow',
        source: actionRequest.source,
        status: actionRequest.status,
      })
      continue
    }

    deleted += 1
    if (!input.dryRun) {
      await input.actionRequests.remove(actionRequest.actionRequestId)
    }
    results.push({
      actionRequestId: actionRequest.actionRequestId,
      outcome: 'deleted',
      reason: 'orphan_paid_call_shadow',
      source: actionRequest.source,
      status: actionRequest.status,
    })
  }

  return {
    checkedPaidCalls: paidCalls.length,
    checkedActionRequests: actionRequests.length,
    created,
    updated,
    deleted,
    unchanged,
    skipped,
    results,
  }
}
