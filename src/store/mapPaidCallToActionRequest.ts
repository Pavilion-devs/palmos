import type {
  ActionExecutionPlan,
  ActionPolicySnapshot,
  ActionRequestRecord,
  ActionRequestSource,
  ActionRequestStatus,
} from './ActionRequestRegistry.js'
import type { PaidCallRecord } from './PaidCallRegistry.js'

function mapPaidCallStatus(
  status: PaidCallRecord['status'],
): ActionRequestStatus {
  switch (status) {
    case 'blocked':
      return 'blocked'
    case 'approval_pending':
      return 'approval_pending'
    case 'waiting_for_execution':
      return 'waiting_for_execution'
    case 'executed':
      return 'executed'
    case 'failed':
    default:
      return 'failed'
  }
}

function mapConnectorKind(
  paymentRail: PaidCallRecord['paymentRail'],
): ActionExecutionPlan['connectorKind'] {
  switch (paymentRail) {
    case 'palmos-pusd':
      return 'pusd'
    case 'umbra':
      return 'umbra'
    default:
      return paymentRail
  }
}

function buildPolicySnapshot(input: {
  record: PaidCallRecord
  existing?: ActionRequestRecord
}): ActionPolicySnapshot {
  const approvalRequired =
    input.existing?.policy.approvalRequired === true ||
    input.record.status === 'approval_pending' ||
    input.record.runtimeStatus === 'waiting_for_approval'

  return {
    policyVersion: input.existing?.policy.policyVersion,
    policyHash: input.existing?.policy.policyHash,
    approvalRequired,
    approvalReason:
      input.existing?.policy.approvalReason ??
      (approvalRequired
        ? 'Legacy PaidCall flow requires operator approval.'
        : undefined),
    limitsApplied: {
      legacyRecordType: 'PaidCall',
      paymentRail: input.record.paymentRail,
      settlementMode: input.record.settlementMode,
      legacyStatus: input.record.status,
    },
  }
}

function buildSummary(record: PaidCallRecord): string {
  if (record.errorMessage) {
    return record.errorMessage
  }

  return `${record.amount} ${record.assetSymbol} for ${record.serviceId} via ${record.paymentRail}.`
}

function readSummaryField(
  summary: PaidCallRecord['requestSummary'],
  key: string,
): unknown {
  return summary[key]
}

function inferSourceFromPaidCall(
  record: PaidCallRecord,
): ActionRequestSource | undefined {
  if (record.requestSource) {
    return record.requestSource
  }

  if (record.executionId.startsWith('paid_call_idem_')) {
    return 'sdk'
  }

  if (
    readSummaryField(record.requestSummary, 'privateSettlementRail') === 'umbra' ||
    readSummaryField(record.requestSummary, 'privateSettlementExecutionId') != null
  ) {
    return 'sdk'
  }

  return undefined
}

function resolveActionRequestSource(input: {
  record: PaidCallRecord
  existing?: ActionRequestRecord
}): ActionRequestSource {
  const inferred = inferSourceFromPaidCall(input.record)
  if (inferred) {
    return inferred
  }

  if (input.existing?.source) {
    return input.existing.source
  }

  return 'system'
}

export function mapPaidCallToActionRequest(
  record: PaidCallRecord,
  existing?: ActionRequestRecord,
): ActionRequestRecord {
  return {
    actionRequestId: record.executionId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    agentId: record.agentId,
    walletId: record.walletId,
    source: resolveActionRequestSource({ record, existing }),
    kind: existing?.kind ?? 'service.pay',
    status: mapPaidCallStatus(record.status),
    target: {
      kind: 'service',
      serviceId: record.serviceId,
      vendorId: record.vendorId,
      endpointUrl: record.requestUrl,
    },
    value: {
      assetSymbol: record.assetSymbol,
      amount: record.amount,
      chainId: record.chainId,
    },
    title: existing?.title ?? `Service payment ${record.serviceId}`,
    summary: buildSummary(record),
    requestPayload: record.requestPayload,
    requestContext: {
      legacyRecordType: 'PaidCall',
      requestSource: record.requestSource,
      requestSummary: record.requestSummary,
      paymentRail: record.paymentRail,
      settlementMode: record.settlementMode,
      transactionSignature: record.transactionSignature,
      transactionExplorerUrl: record.transactionExplorerUrl,
      responseStatus: record.responseStatus,
      responseHeaders: record.responseHeaders,
      responsePreview: record.responsePreview,
      settlement: record.settlement,
      umbraSettlement: record.umbraSettlement,
    },
    policy: buildPolicySnapshot({ record, existing }),
    executionPlan: {
      connectorKind: mapConnectorKind(record.paymentRail),
      settlementAsset: record.assetSymbol,
      privacyMode:
        record.paymentRail === 'umbra' || record.umbraSettlement
          ? 'required'
          : 'off',
      executionMode: record.settlementMode,
    },
    runtimeRefs: {
      sessionId: record.sessionId,
      runId: record.runId,
      intentIds: existing?.runtimeRefs?.intentIds ?? [],
      broadcastRefs: existing?.runtimeRefs?.broadcastRefs,
      simulationRefs: existing?.runtimeRefs?.simulationRefs,
    },
    resultRef:
      record.umbraSettlement?.reportId ??
      record.transactionSignature ??
      record.settlement?.reference ??
      record.settlement?.signature,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
  }
}
