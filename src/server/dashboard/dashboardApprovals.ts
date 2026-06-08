import type {
  ActionRequestKind,
  ActionRequestRecord,
  ActionRequestStatus,
  ActionTarget,
} from '../../store/ActionRequestRegistry.js'
import type {
  PaidCallPaymentRail,
  PaidCallRecord,
  PaidCallStatus,
} from '../../store/PaidCallRegistry.js'
import type { AgentSpendWorkspace } from '../../workspace/loadWorkspace.js'
import { isNativeWalletActionRequest } from './walletActions.js'

/**
 * Unified dashboard approval-queue projection.
 *
 * Surfaces everything that needs (or recently needed) an operator decision from
 * both settlement sources, without forcing one through the other:
 *
 *  - `legacy_paid_call`     — PaidCall rows awaiting approval / execution.
 *  - `native_wallet_action` — native ActionRequest rows awaiting approval.
 *
 * The pending sets intentionally mirror the snapshot-derived approval queue the
 * dashboard renders today so switching the read source is behaviour-preserving:
 * paid calls include `approval_pending` and `waiting_for_execution`; native
 * wallet actions include `approval_pending`.
 */
export type DashboardApprovalKind = 'legacy_paid_call' | 'native_wallet_action'

export const LEGACY_APPROVAL_PENDING_STATUSES: readonly PaidCallStatus[] = [
  'approval_pending',
  'waiting_for_execution',
]

export const NATIVE_APPROVAL_PENDING_STATUSES: readonly ActionRequestStatus[] = [
  'approval_pending',
]

export type DashboardApproval = {
  id: string
  transactionKind: DashboardApprovalKind
  // Resolver hint: 'paid_call' for legacy rows, the ActionRequestKind for
  // native rows (e.g. 'asset.transfer'). The approval mutation route already
  // branches on this distinction.
  approvalKind: string
  agentId: string
  walletId?: string
  status: PaidCallStatus | ActionRequestStatus
  title: string
  summary: string
  reason?: string
  amount?: string
  assetSymbol?: string
  chainId?: string
  createdAt: string
  updatedAt: string
  approval: {
    required: boolean
    reason?: string
    approvalStateRef?: string
  }
  xmtp: {
    requested: boolean
  }
  // Scoped, explicit target ids per kind so the dashboard (and the resolver)
  // can address the underlying record without re-deriving it.
  targets: {
    serviceId?: string
    vendorId?: string
    paymentRail?: PaidCallPaymentRail
    walletActionId?: string
    actionRequestId?: string
    counterpartyId?: string
    target?: ActionTarget
  }
}

export type DashboardApprovals = {
  projectionMode: 'shadow' | 'transactional_mirror'
  summary: {
    totalPending: number
    totalAmount: string
    byTransactionKind: Record<DashboardApprovalKind, number>
    byApprovalKind: Partial<Record<string, number>>
  }
  approvals: DashboardApproval[]
}

export type DashboardApprovalsQuery = {
  agentId?: string
  walletId?: string
}

function readApprovalStateRef(record: ActionRequestRecord): string | undefined {
  return typeof record.requestContext?.approvalStateRef === 'string'
    ? record.requestContext.approvalStateRef
    : undefined
}

function nativeApprovalReason(record: ActionRequestRecord): string {
  if (record.policy?.approvalReason) {
    return record.policy.approvalReason
  }
  if (record.status === 'approval_pending') {
    return 'Awaiting operator approval'
  }
  return record.summary
}

function projectNativeApproval(record: ActionRequestRecord): DashboardApproval {
  const counterpartyId =
    record.target.kind === 'address' ? record.target.counterpartyId : undefined
  const chainId =
    record.value?.chainId ??
    (record.target.kind === 'address' || record.target.kind === 'wallet'
      ? record.target.chainId
      : undefined)

  return {
    id: record.actionRequestId,
    transactionKind: 'native_wallet_action',
    approvalKind: record.kind,
    agentId: record.agentId,
    walletId: record.walletId,
    status: record.status,
    title: record.title,
    summary: record.summary,
    reason: nativeApprovalReason(record),
    amount: record.value?.amount,
    assetSymbol: record.value?.assetSymbol,
    chainId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    approval: {
      required: Boolean(record.policy?.approvalRequired),
      reason: record.policy?.approvalReason,
      approvalStateRef: readApprovalStateRef(record),
    },
    xmtp: {
      // Native wallet-action XMTP alerting is not wired yet; mirror the current
      // snapshot behaviour (no alert) rather than implying one was sent.
      requested: false,
    },
    targets: {
      walletActionId: record.actionRequestId,
      actionRequestId: record.actionRequestId,
      counterpartyId,
      target: record.target,
    },
  }
}

function legacyApprovalReason(record: PaidCallRecord): string {
  if (record.errorMessage) {
    return record.errorMessage
  }
  if (record.status === 'waiting_for_execution') {
    return 'Approved — waiting for execution'
  }
  return 'Awaiting operator approval'
}

function projectLegacyApproval(input: {
  record: PaidCallRecord
  xmtpRequested: boolean
}): DashboardApproval {
  const { record } = input
  return {
    id: record.executionId,
    transactionKind: 'legacy_paid_call',
    approvalKind: 'paid_call',
    agentId: record.agentId,
    walletId: record.walletId,
    status: record.status,
    title: `Service payment ${record.serviceId}`,
    summary:
      record.errorMessage ??
      `${record.amount} ${record.assetSymbol} for ${record.serviceId} via ${record.paymentRail}.`,
    reason: legacyApprovalReason(record),
    amount: record.amount,
    assetSymbol: record.assetSymbol,
    chainId: record.chainId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    approval: {
      required: true,
      reason: legacyApprovalReason(record),
    },
    xmtp: {
      requested: input.xmtpRequested,
    },
    targets: {
      serviceId: record.serviceId,
      vendorId: record.vendorId,
      paymentRail: record.paymentRail,
    },
  }
}

function sortApprovalsByRecency(
  left: DashboardApproval,
  right: DashboardApproval,
): number {
  return (
    right.createdAt.localeCompare(left.createdAt) ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.id.localeCompare(left.id)
  )
}

export async function buildDashboardApprovals(input: {
  workspace: AgentSpendWorkspace
  query?: DashboardApprovalsQuery
}): Promise<DashboardApprovals> {
  const query = input.query ?? {}

  // Native approvals: native wallet-action ActionRequests awaiting approval.
  let nativeApprovals: DashboardApproval[] = []
  if (input.workspace.actionRequestRegistry) {
    const result = await input.workspace.actionRequestRegistry.query({
      status: 'approval_pending',
      agentId: query.agentId,
      limit: 500,
    })
    nativeApprovals = result.records
      .filter(isNativeWalletActionRequest)
      .filter(
        (record) => !query.walletId || record.walletId === query.walletId,
      )
      .map(projectNativeApproval)
  }
  const nativeIds = new Set(nativeApprovals.map((approval) => approval.id))

  // Legacy approvals: PaidCalls awaiting approval or execution. The XMTP join
  // mirrors the snapshot's approval-alert chip for paid calls.
  const xmtpRequestedIds = new Set<string>()
  const alerts = await input.workspace.xmtpAlertRegistry.list()
  for (const alert of alerts) {
    if (
      alert.type === 'approval.requested' &&
      alert.status === 'sent' &&
      alert.executionId
    ) {
      xmtpRequestedIds.add(alert.executionId)
    }
  }

  const paidCalls = await input.workspace.paidCallRegistry.list()
  const legacyApprovals = paidCalls
    .filter((record) =>
      LEGACY_APPROVAL_PENDING_STATUSES.includes(record.status),
    )
    .filter((record) => !query.agentId || record.agentId === query.agentId)
    .filter((record) => !query.walletId || record.walletId === query.walletId)
    // Prefer the native representation if the id is already covered.
    .filter((record) => !nativeIds.has(record.executionId))
    .map((record) =>
      projectLegacyApproval({
        record,
        xmtpRequested: xmtpRequestedIds.has(record.executionId),
      }),
    )

  const approvals = [...nativeApprovals, ...legacyApprovals].sort(
    sortApprovalsByRecency,
  )

  const byTransactionKind: Record<DashboardApprovalKind, number> = {
    legacy_paid_call: 0,
    native_wallet_action: 0,
  }
  const byApprovalKind: Partial<Record<string, number>> = {}
  let totalAmount = 0
  for (const approval of approvals) {
    byTransactionKind[approval.transactionKind] += 1
    byApprovalKind[approval.approvalKind] =
      (byApprovalKind[approval.approvalKind] ?? 0) + 1
    const parsed = Number(approval.amount)
    if (Number.isFinite(parsed)) {
      totalAmount += parsed
    }
  }

  return {
    projectionMode:
      input.workspace.storageDriver === 'postgres'
        ? 'transactional_mirror'
        : 'shadow',
    summary: {
      totalPending: approvals.length,
      totalAmount: String(totalAmount),
      byTransactionKind,
      byApprovalKind,
    },
    approvals,
  }
}
