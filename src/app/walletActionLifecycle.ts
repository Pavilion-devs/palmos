import type {
  ActionRequestKind,
  ActionRequestRecord,
  ActionRequestStatus,
} from '../store/ActionRequestRegistry.js'

export const DEFAULT_WALLET_ACTION_STALE_AFTER_MS = 5 * 60 * 1000

export const WALLET_ACTION_STALE_STATUSES: ActionRequestStatus[] = [
  'created',
  'policy_checked',
  'waiting_for_execution',
  'executing',
]

export const RECONCILED_WALLET_ACTION_KINDS: ActionRequestKind[] = [
  'asset.transfer',
  'wallet.create',
  'wallet.policy_update',
]

export function isReconciledWalletActionKind(
  kind: ActionRequestKind,
): boolean {
  return RECONCILED_WALLET_ACTION_KINDS.includes(kind)
}

export function isWalletActionStaleStatus(
  status: ActionRequestStatus,
): boolean {
  return WALLET_ACTION_STALE_STATUSES.includes(status)
}

export function readWalletActionAgeMs(input: {
  record: Pick<ActionRequestRecord, 'updatedAt'>
  now?: string
}): number | undefined {
  const nowMs = Date.parse(input.now ?? new Date().toISOString())
  const updatedAtMs = Date.parse(input.record.updatedAt)
  if (!Number.isFinite(nowMs) || !Number.isFinite(updatedAtMs)) {
    return undefined
  }
  return Math.max(0, nowMs - updatedAtMs)
}

export function isWalletActionStale(input: {
  record: Pick<ActionRequestRecord, 'kind' | 'status' | 'updatedAt'>
  now?: string
  staleAfterMs?: number
}): boolean {
  if (!isReconciledWalletActionKind(input.record.kind)) {
    return false
  }
  if (!isWalletActionStaleStatus(input.record.status)) {
    return false
  }
  const ageMs = readWalletActionAgeMs({
    record: input.record,
    now: input.now,
  })
  if (ageMs == null) {
    return false
  }
  return ageMs >= (input.staleAfterMs ?? DEFAULT_WALLET_ACTION_STALE_AFTER_MS)
}
