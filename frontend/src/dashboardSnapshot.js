const LIVE_STATUS_MAP = {
  ready: 'active',
  approval_pending: 'pending',
  restricted: 'blocked',
  suspended: 'blocked',
  archived: 'revoked',
  stale: 'revoked',
  failed: 'denied',
  draft: 'idle',
  wallet_pending: 'idle',
}

function parseAmount(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseTimestamp(value) {
  const parsed = Date.parse(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function formatClock(value) {
  const parsed = parseTimestamp(value)
  if (!parsed) {
    return '—'
  }

  return new Date(parsed).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function humanizeToken(value) {
  return String(value ?? '')
    .replace(/[_.-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function formatChainLabel(chainId) {
  return String(chainId ?? '')
    .replace(/-/g, ' ')
    .toUpperCase()
}

function formatUsdAmount(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatApprovalRange(autoApproveUnder, maxPerTransaction) {
  const lower = parseAmount(autoApproveUnder)
  const upper = parseAmount(maxPerTransaction)

  if (!lower && !upper) {
    return 'n/a'
  }

  return `${lower.toFixed(2)} - ${upper.toFixed(2)} PUSD`
}

function formatDeadManSwitch(seconds) {
  const parsed = Number(seconds)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 'n/a'
  }

  if (parsed % 60 === 0) {
    return `${parsed / 60} min`
  }

  return `${parsed}s`
}

function toInitial(displayName) {
  return String(displayName ?? '').trim().charAt(0).toUpperCase() || '?'
}

function decodePaymentResponse(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') {
    return undefined
  }

  try {
    const decoded = globalThis.atob(headerValue)
    return JSON.parse(decoded)
  } catch {
    return undefined
  }
}

function shortTxHash(value) {
  if (!value) {
    return null
  }

  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

const SOLANA_BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/

function isProbablyRealSolanaSignature(value) {
  if (!value || typeof value !== 'string') {
    return false
  }
  if (value.length < 80) {
    return false
  }
  return SOLANA_BASE58_PATTERN.test(value)
}

function buildSolscanTxUrl(signature, chainId) {
  if (!isProbablyRealSolanaSignature(signature) || chainId === 'solana-local') {
    return null
  }

  const cluster = chainId === 'solana-devnet' ? '?cluster=devnet' : ''
  return `https://solscan.io/tx/${signature}${cluster}`
}

function deriveSettlementMode(record, txHashFull) {
  if (record.paymentRail === 'umbra' || record.umbraSettlement) {
    return 'umbra'
  }

  if (
    record.status === 'approval_pending' ||
    record.status === 'waiting_for_execution'
  ) {
    return 'approval_pending'
  }

  if (record.status === 'blocked' || record.status === 'failed') {
    return 'blocked'
  }

  if (record.status === 'executed') {
    return isProbablyRealSolanaSignature(txHashFull) ? 'real' : 'local'
  }

  return 'unknown'
}

function getPolicyVendorLabel(agentSnapshot, vendorId) {
  const vendors = agentSnapshot?.agent?.policyConfig?.allowedVendors ?? []
  const vendor = vendors.find((item) => item.vendorId === vendorId)
  return vendor?.label ?? humanizeToken(vendorId)
}

function buildActionLabel(agentSnapshot, record) {
  const vendorLabel = getPolicyVendorLabel(agentSnapshot, record.vendorId)

  if (record.paymentRail === 'umbra' || record.umbraSettlement) {
    if (record.serviceId === 'palmos.launch.audit') {
      return `Private launch audit via ${vendorLabel}`
    }
    return 'Umbra private settlement proof'
  }

  if (record.serviceId === 'palmos.launch.audit') {
    return `Production launch audit via ${vendorLabel}`
  }

  if (record.serviceId === 'coingecko.simple_price') {
    return `Crypto data via ${vendorLabel}`
  }

  if (
    record.serviceId === 'local.demo.ops_brief' ||
    record.serviceId === 'local.pusd.ops_brief' ||
    record.serviceId === 'palmos.research.defi_risk'
  ) {
    return `Risk report via ${vendorLabel}`
  }

  if (
    record.serviceId === 'local.demo.spot_price' ||
    record.serviceId === 'local.pusd.spot_price' ||
    record.serviceId === 'palmos.intel.onchain_flow'
  ) {
    return `On-chain flow query via ${vendorLabel}`
  }

  if (record.serviceId === 'palmos.ops.vendor_brief') {
    return `Vendor brief via ${vendorLabel}`
  }

  const requestSummary = record.requestSummary ?? {}

  if (Array.isArray(requestSummary.symbols) && requestSummary.symbols.length > 0) {
    return `Market data via ${vendorLabel}`
  }

  return `${humanizeToken(record.serviceId)} via ${vendorLabel}`
}

function getMatchingXMTPAlerts(agentSnapshot, executionId) {
  return (agentSnapshot?.xmtpAlerts ?? []).filter(
    (record) => record.executionId === executionId,
  )
}

function buildReason(agentSnapshot, record) {
  if (record.paymentRail === 'umbra' || record.umbraSettlement) {
    const reconciliation = record.umbraSettlement?.reconciliationStatus
    if (record.status === 'executed' && reconciliation === 'matched') {
      return 'Umbra devnet mixer/UTXO reconciliation matched'
    }
    if (record.status === 'executed') {
      return 'Umbra private settlement executed'
    }
    if (
      record.status === 'approval_pending' ||
      record.status === 'waiting_for_execution'
    ) {
      return 'Umbra private settlement awaiting approval'
    }
    return record.errorMessage ?? 'Umbra private settlement did not execute'
  }

  const requiresApproval =
    parseAmount(record.amount) >
    parseAmount(agentSnapshot?.agent?.policyConfig?.autoApproveUnder)
  const alerts = getMatchingXMTPAlerts(agentSnapshot, record.executionId)
  const xmtpSent = alerts.some(
    (recordItem) =>
      recordItem.type === 'approval.requested' && recordItem.status === 'sent',
  )

  if (record.status === 'executed') {
    return requiresApproval
      ? xmtpSent
        ? 'Approved by operator after XMTP alert'
        : 'Approved by operator'
      : `Auto-approved under ${parseAmount(
          agentSnapshot?.agent?.policyConfig?.autoApproveUnder,
        ).toFixed(2)} PUSD`
  }

  if (
    record.status === 'approval_pending' ||
    record.status === 'waiting_for_execution'
  ) {
    return xmtpSent ? 'XMTP alert sent to operator' : 'Awaiting operator approval'
  }

  if (record.status === 'blocked' || record.status === 'failed') {
    return (
      record.errorMessage ??
      (record.status === 'blocked' ? 'Blocked by policy' : 'Execution failed')
    )
  }

  return 'Recorded'
}

function buildTxHash(record) {
  const paymentResponse =
    decodePaymentResponse(record.responseHeaders?.['x-pusd-payment-response']) ??
    decodePaymentResponse(record.responseHeaders?.['x-payment-response'])

  return record.transactionSignature ?? paymentResponse?.transaction ?? null
}

function mapPaidCallResult(record) {
  if (record.status === 'executed') {
    return 'approved'
  }

  if (
    record.status === 'approval_pending' ||
    record.status === 'waiting_for_execution'
  ) {
    return 'pending'
  }

  return 'denied'
}

function getActionRequestAmount(record) {
  return parseAmount(record.value?.amount)
}

function getActionRequestAssetSymbol(record) {
  return record.value?.assetSymbol ?? record.executionPlan?.settlementAsset ?? 'PUSD'
}

function getActionRequestCounterpartyId(record) {
  return record.target?.kind === 'address'
    ? record.target.counterpartyId
    : undefined
}

function buildActionRequestActionLabel(agentSnapshot, record) {
  if (record.kind === 'asset.transfer' && record.target?.kind === 'address') {
    const counterpartyId = getActionRequestCounterpartyId(record)
    const counterpartyLabel = counterpartyId
      ? getPolicyVendorLabel(agentSnapshot, counterpartyId)
      : shortTxHash(record.target.address) ?? 'external address'
    return `Wallet transfer to ${counterpartyLabel}`
  }

  return humanizeToken(record.kind)
}

function mapActionRequestResult(record) {
  if (record.status === 'executed') {
    return 'approved'
  }

  if (
    record.status === 'approval_pending' ||
    record.status === 'waiting_for_execution' ||
    record.status === 'executing' ||
    record.status === 'policy_checked'
  ) {
    return 'pending'
  }

  return 'denied'
}

function buildActionRequestReason(record) {
  if (record.status === 'approval_pending') {
    return record.policy?.approvalReason
      ? humanizeToken(record.policy.approvalReason)
      : 'Awaiting operator approval'
  }

  if (record.status === 'waiting_for_execution' || record.status === 'executing') {
    return 'Transfer is waiting for execution'
  }

  if (record.status === 'blocked' || record.status === 'failed') {
    return record.errorMessage ?? humanizeToken(record.errorCode ?? record.status)
  }

  if (record.status === 'executed') {
    return 'Native wallet action executed'
  }

  return 'Native wallet action recorded'
}

function deriveActionRequestSettlementMode(record) {
  if (record.status === 'approval_pending') {
    return 'approval_pending'
  }

  if (record.status === 'blocked' || record.status === 'failed') {
    return 'blocked'
  }

  if (record.status === 'executed') {
    return record.executionPlan?.executionMode === 'real-solana' ? 'real' : 'local'
  }

  return 'approval_pending'
}

function buildEvent(agentSnapshot, record) {
  const requiredApproval =
    parseAmount(record.amount) >
    parseAmount(agentSnapshot?.agent?.policyConfig?.autoApproveUnder)
  const alerts = getMatchingXMTPAlerts(agentSnapshot, record.executionId)
  const approvedByOperator =
    requiredApproval &&
    record.status === 'executed' &&
    alerts.some((item) => item.type === 'approval.requested')
  const xmtpSent = alerts.some(
    (item) => item.type === 'approval.requested' && item.status === 'sent',
  )
  const xmtpResolutionSent = alerts.some(
    (item) => item.type === 'approval.resolved' && item.status === 'sent',
  )
  const txHashFull = buildTxHash(record)
  const baseAction = buildActionLabel(agentSnapshot, record)

  return {
    id: record.executionId,
    atMs: parseTimestamp(record.updatedAt || record.createdAt),
    createdAtMs: parseTimestamp(record.createdAt),
    timestamp: formatClock(record.updatedAt || record.createdAt),
    agentId: record.agentId,
    agentName: agentSnapshot?.agent?.displayName ?? humanizeToken(record.agentId),
    type: 'spend',
    action: approvedByOperator ? `${baseAction} - APPROVED by operator` : baseAction,
    amount: parseAmount(record.amount),
    assetSymbol: record.assetSymbol ?? 'PUSD',
    result: mapPaidCallResult(record),
    reason: buildReason(agentSnapshot, record),
    vendor: getPolicyVendorLabel(agentSnapshot, record.vendorId),
    vendorId: record.vendorId ?? null,
    serviceId: record.serviceId ?? null,
    paymentRail: record.paymentRail ?? null,
    umbraSettlement: record.umbraSettlement ?? null,
    proofAgentSource:
      record.requestSummary?.proofAgentSource ??
      record.requestPayload?.proofAgentSource ??
      null,
    syntheticProofAgent:
      record.requestSummary?.syntheticProofAgent ??
      record.requestPayload?.syntheticProofAgent ??
      null,
    umbraPolicyAttached:
      record.requestSummary?.umbraPolicyAttached ??
      record.requestPayload?.umbraPolicyAttached ??
      null,
    chainId: record.chainId ?? null,
    txHash: shortTxHash(txHashFull),
    txHashFull,
    txExplorerUrl:
      record.transactionExplorerUrl ??
      buildSolscanTxUrl(txHashFull, record.chainId),
    status: record.status,
    errorCode: record.errorCode ?? null,
    errorMessage: record.errorMessage ?? null,
    badgeLabel: buildPaidCallBadge(record, approvedByOperator),
    settlementMode: deriveSettlementMode(record, txHashFull),
    requiredApproval,
    approvedByOperator,
    xmtpSent,
    xmtpResolutionSent,
  }
}

function buildPaidCallBadge(record, approvedByOperator) {
  if (record.paymentRail === 'umbra' || record.umbraSettlement) {
    if (record.status === 'executed') {
      return record.umbraSettlement?.reconciliationStatus === 'matched'
        ? 'UMBRA MATCHED'
        : 'UMBRA EXECUTED'
    }
    if (
      record.status === 'approval_pending' ||
      record.status === 'waiting_for_execution'
    ) {
      return 'UMBRA PENDING'
    }
    return record.status === 'failed' ? 'UMBRA FAILED' : 'UMBRA BLOCKED'
  }

  const result = mapPaidCallResult(record)

  if (result === 'approved') {
    return approvedByOperator ? 'OPERATOR-APPROVED' : 'AUTO-APPROVED'
  }

  if (result === 'pending') {
    return record.status === 'waiting_for_execution'
      ? 'WAITING EXECUTION'
      : 'PENDING APPROVAL'
  }

  if (record.errorCode === 'policy.session_budget_exceeded') {
    return 'BUDGET BLOCK'
  }

  if (record.errorCode === 'policy.runtime_denied') {
    return 'RUNTIME DENIED'
  }

  return record.status === 'failed' ? 'FAILED' : 'POLICY BLOCK'
}

function buildXmtpActionLabel(alertRecord) {
  if (alertRecord.type === 'approval.requested') {
    return 'XMTP approval request sent to operator'
  }

  if (alertRecord.type === 'approval.resolved') {
    return 'XMTP approval resolution sent to operator'
  }

  if (alertRecord.type === 'dead_man_switch.triggered') {
    return "XMTP dead man's switch alert sent"
  }

  return humanizeToken(alertRecord.type)
}

function buildXmtpEvent(agentSnapshot, alertRecord) {
  return {
    id: `xmtp:${alertRecord.alertId}`,
    atMs: parseTimestamp(alertRecord.updatedAt || alertRecord.createdAt),
    timestamp: formatClock(alertRecord.updatedAt || alertRecord.createdAt),
    agentId: alertRecord.agentId ?? agentSnapshot?.agent?.agentId ?? 'unknown',
    agentName:
      agentSnapshot?.agent?.displayName ??
      humanizeToken(alertRecord.agentId ?? 'unknown'),
    type: 'xmtp',
    action: buildXmtpActionLabel(alertRecord),
    amount: null,
    result:
      alertRecord.status === 'sent'
        ? 'info'
        : alertRecord.status === 'failed'
          ? 'denied'
          : 'pending',
    reason: alertRecord.messagePreview || humanizeToken(alertRecord.type),
    vendor: 'XMTP',
    txHash: null,
    txHashFull: null,
    badgeLabel:
      alertRecord.status === 'sent'
        ? 'XMTP'
        : alertRecord.status === 'failed'
          ? 'XMTP FAILED'
          : 'XMTP PENDING',
  }
}

function buildPortfolioSummary(portfolioSnapshot) {
  const positions = portfolioSnapshot?.positions ?? []
  const transactions = portfolioSnapshot?.transactions ?? []
  const sync = portfolioSnapshot?.sync ?? {
    kind: 'disabled',
    message: 'Portfolio enrichment is not configured on the backend.',
    chainId: null,
  }
  const portfolioValue = positions.reduce(
    (sum, position) => sum + formatUsdAmount(position.value),
    0,
  )
  const latestTransaction = [...transactions]
    .filter((transaction) => parseTimestamp(transaction.minedAt) > 0)
    .sort(
      (left, right) =>
        parseTimestamp(right.minedAt) - parseTimestamp(left.minedAt),
    )[0]

  return {
    walletAddress: portfolioSnapshot?.address ?? null,
    positionsCount: positions.length,
    transactionsCount: transactions.length,
    portfolioValue,
    latestTransactionAt: latestTransaction?.minedAt ?? null,
    latestTransactionChain: latestTransaction?.chainId ?? null,
    syncKind: sync.kind,
    syncMessage: sync.message,
    syncChainId: sync.chainId ?? null,
  }
}

function formatPortfolioValueDisplay(portfolio) {
  if (portfolio.syncKind === 'synced') {
    return `$${(portfolio.portfolioValue ?? 0).toFixed(2)}`
  }

  if (portfolio.syncKind === 'empty') {
    return 'no data'
  }

  if (portfolio.syncKind === 'unsupported_chain' && portfolio.syncChainId) {
    return `unsupported on ${portfolio.syncChainId}`
  }

  if (portfolio.syncKind === 'request_failed') {
    return 'sync failed'
  }

  if (portfolio.syncKind === 'missing_wallet_address') {
    return 'wallet unavailable'
  }

  if (portfolio.syncKind === 'disabled') {
    return 'disabled'
  }

  return 'unavailable'
}

function formatPortfolioLatestDisplay(portfolio) {
  if (portfolio.latestTransactionAt) {
    return `${portfolio.latestTransactionAt}${portfolio.latestTransactionChain ? ` · ${String(portfolio.latestTransactionChain).toUpperCase()}` : ''}`
  }

  if (portfolio.syncKind === 'unsupported_chain' && portfolio.syncChainId) {
    return `unsupported on ${portfolio.syncChainId}`
  }

  if (portfolio.syncKind === 'empty') {
    return 'no data'
  }

  if (portfolio.syncKind === 'request_failed') {
    return 'sync failed'
  }

  if (portfolio.syncKind === 'missing_wallet_address') {
    return 'wallet unavailable'
  }

  if (portfolio.syncKind === 'disabled') {
    return 'disabled'
  }

  return 'unavailable'
}

function getCommittedSpend(paidCalls) {
  return paidCalls
    .filter((record) =>
      ['executed', 'approval_pending', 'waiting_for_execution'].includes(
        record.status,
      ),
    )
    .reduce((sum, record) => sum + parseAmount(record.amount), 0)
}

function getCommittedActionRequestSpend(actionRequests) {
  return actionRequests
    .filter((record) =>
      ['executed', 'approval_pending', 'waiting_for_execution'].includes(
        record.status,
      ),
    )
    .reduce((sum, record) => sum + getActionRequestAmount(record), 0)
}

function getLatestPaidCall(paidCalls) {
  return [...paidCalls].sort(
    (left, right) =>
      parseTimestamp(right.updatedAt || right.createdAt) -
      parseTimestamp(left.updatedAt || left.createdAt),
  )[0]
}

function deriveAgent(agentSnapshot) {
  const agent = agentSnapshot.agent
  const paidCalls = agentSnapshot.paidCalls ?? []
  const actionRequests = agentSnapshot.actionRequests ?? []
  const umbraPolicy = agent.policyConfig?.umbra
  const portfolio = buildPortfolioSummary(agentSnapshot.portfolio)
  const executedAmount = paidCalls
    .filter((record) => record.status === 'executed')
    .reduce((sum, record) => sum + parseAmount(record.amount), 0)
  const executedActionRequestAmount = actionRequests
    .filter((record) => record.status === 'executed')
    .reduce((sum, record) => sum + getActionRequestAmount(record), 0)
  const committedAmount =
    getCommittedSpend(paidCalls) + getCommittedActionRequestSpend(actionRequests)
  const maxPerTransaction = parseAmount(agent.policyConfig?.maxPerTransaction)
  const sessionBudget = parseAmount(agent.policyConfig?.sessionBudget)
  const budgetTotal = sessionBudget || maxPerTransaction
  const autoApproveUnder = parseAmount(agent.policyConfig?.autoApproveUnder)
  const remainingSessionBudget = Math.max(0, budgetTotal - committedAmount)
  const latestPaidCall = getLatestPaidCall(paidCalls)
  const blockedCount = paidCalls.filter((record) =>
    ['blocked', 'failed'].includes(record.status),
  ).length

  return {
    id: agent.agentId,
    name: agent.displayName,
    letter: toInitial(agent.displayName),
    lifecycleStatus: agent.status,
    status: LIVE_STATUS_MAP[agent.status] ?? 'idle',
    chain: formatChainLabel(agent.policyConfig?.allowedChains?.[0] ?? 'unknown'),
    trustTier: agent.trustTier,
    balance: remainingSessionBudget,
    budgetTotal,
    budgetUsed: committedAmount,
    executedSpend: executedAmount + executedActionRequestAmount,
    blockedCount,
    lastCheckIn: parseTimestamp(agent.lastCheckInAt),
    deadManSeconds: Number(agent.policyConfig?.heartbeatTimeoutSeconds ?? 0),
    policy: {
      sessionBudget: budgetTotal,
      sessionBudgetDisplay: `${budgetTotal.toFixed(2)} PUSD session budget`,
      sessionSpent: committedAmount,
      sessionRemaining: remainingSessionBudget,
      maxPerCall: maxPerTransaction,
      maxPerCallDisplay: `${maxPerTransaction.toFixed(2)} PUSD max / call`,
      chain: agent.policyConfig?.allowedChains?.length
        ? agent.policyConfig.allowedChains.map(formatChainLabel).join(', ')
        : 'n/a',
      vendors: (agent.policyConfig?.allowedVendors ?? []).map(
        (vendor) => vendor.label ?? humanizeToken(vendor.vendorId),
      ),
      allowedVendorIds: (agent.policyConfig?.allowedVendors ?? []).map(
        (vendor) => vendor.vendorId,
      ),
      autoApproveMax: autoApproveUnder,
      approvalRange: formatApprovalRange(
        agent.policyConfig?.autoApproveUnder,
        agent.policyConfig?.maxPerTransaction,
      ),
      hardBlock: `> ${maxPerTransaction.toFixed(2)} PUSD`,
      deadManSwitch: formatDeadManSwitch(
        agent.policyConfig?.heartbeatTimeoutSeconds,
      ),
      settlementMode: agent.settlementMode ?? 'local-demo',
      walletBackend: agent.walletBackend ?? (agentSnapshot.owsAccess ? 'ows' : 'runtime'),
      owsWalletName:
        agent.owsWalletName ?? agentSnapshot.owsAccess?.owsWalletName ?? 'Not attached',
      apiKeyId:
        agent.owsApiKeyId ?? agentSnapshot.owsAccess?.apiKeyId ?? 'Not issued',
      apiKeyName:
        agentSnapshot.owsAccess?.apiKeyName ?? 'Not issued',
      walletState: agent.walletState ?? 'unknown',
      signerProfileId: agent.signerProfileId ?? 'unassigned',
      policyProfileId: agent.policyProfileId ?? 'unassigned',
      xmtpAlertCount: (agentSnapshot.xmtpAlerts ?? []).length,
      latestXmtpType:
        (agentSnapshot.xmtpAlerts ?? []).at(-1)?.type ?? 'none',
      latestOutcome: (latestPaidCall?.status ?? 'no paid calls').replaceAll('_', ' '),
      latestErrorCode: latestPaidCall?.errorCode ?? null,
      latestReason: latestPaidCall?.errorMessage ?? null,
      latestServiceId: latestPaidCall?.serviceId ?? null,
      latestAmount: latestPaidCall ? parseAmount(latestPaidCall.amount) : null,
      executedSpend: executedAmount + executedActionRequestAmount,
      committedSpend: committedAmount,
      blockedCount,
      portfolioWalletAddress: portfolio.walletAddress,
      portfolioPositionsCount: portfolio.positionsCount,
      portfolioTransactionsCount: portfolio.transactionsCount,
      portfolioValue: portfolio.portfolioValue,
      portfolioLatestTransactionAt: portfolio.latestTransactionAt,
      portfolioLatestTransactionChain: portfolio.latestTransactionChain,
      portfolioSyncKind: portfolio.syncKind,
      portfolioSyncMessage: portfolio.syncMessage,
      portfolioSyncChainId: portfolio.syncChainId,
      portfolioValueDisplay: formatPortfolioValueDisplay(portfolio),
      portfolioLatestDisplay: formatPortfolioLatestDisplay(portfolio),
      umbraEnabled: Boolean(umbraPolicy?.mixerRequired),
      umbraDefaultPath: umbraPolicy?.defaultPath ?? 'not attached',
      umbraViewingKeyRetention: umbraPolicy?.viewingKeyRetention ?? 'not attached',
      umbraDisclosureRecipients:
        umbraPolicy?.disclosureRecipients?.length
          ? umbraPolicy.disclosureRecipients.join(', ')
          : 'artifact only',
    },
  }
}

function buildNativeTransactionAction(row) {
  const target = row.target ?? {}
  if (row.actionRequestKind === 'asset.transfer' && target.kind === 'address') {
    const counterparty = target.counterpartyId
      ? humanizeToken(target.counterpartyId)
      : shortTxHash(target.address) ?? 'external address'
    return `Wallet transfer to ${counterparty}`
  }

  return humanizeToken(row.actionRequestKind)
}

function buildNativeTransactionVendor(row) {
  const target = row.target ?? {}
  if (target.kind === 'address') {
    return target.counterpartyId
      ? humanizeToken(target.counterpartyId)
      : shortTxHash(target.address) ?? 'External address'
  }

  return humanizeToken(target.kind)
}

function adaptNativeWalletActionRow(row, agentsById) {
  const target = row.target ?? {}
  const runtime = row.runtime ?? {}
  const txHashFull = row.transactionRef ?? row.resultRef ?? null
  const counterpartyId =
    target.kind === 'address' ? target.counterpartyId ?? null : null

  return {
    id: row.id ?? row.walletActionId,
    transactionKind: 'native_wallet_action',
    atMs: parseTimestamp(row.updatedAt || row.createdAt),
    createdAtMs: parseTimestamp(row.createdAt),
    timestamp: formatClock(row.updatedAt || row.createdAt),
    agentId: row.agentId,
    agentName: agentsById.get(row.agentId)?.name ?? humanizeToken(row.agentId),
    type: 'spend',
    action: buildNativeTransactionAction(row),
    amount: getActionRequestAmount({ value: row.value }),
    assetSymbol: row.value?.assetSymbol ?? 'PUSD',
    result: mapActionRequestResult({ status: row.status }),
    reason: buildActionRequestReason({
      status: row.status,
      policy: { approvalReason: row.approval?.reason },
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
    }),
    vendor: buildNativeTransactionVendor(row),
    vendorId: counterpartyId,
    serviceId: null,
    paymentRail: runtime.connectorKind ?? 'direct',
    umbraSettlement: null,
    chainId: row.value?.chainId ?? target.chainId ?? null,
    txHash: shortTxHash(txHashFull),
    txHashFull,
    txExplorerUrl: buildSolscanTxUrl(txHashFull, row.value?.chainId ?? target.chainId ?? null),
    // Mantle decision-log stamp (additive audit layer): a Mantlescan link to the on-chain record
    // of this governed decision + outcome, set when MANTLE_RECORD_LIVE=1.
    mantleTxUrl: row.mantle?.txUrl ?? null,
    mantleRecorded: row.mantle?.recorded ?? false,
    mantleVerdict: row.mantle?.verdict ?? null,
    mantleOutcome: row.mantle?.outcome ?? null,
    status: row.status,
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    settlementMode: deriveActionRequestSettlementMode({
      status: row.status,
      executionPlan: { executionMode: runtime.executionMode },
    }),
    requiredApproval: Boolean(row.approval?.required),
    actionRequestKind: row.actionRequestKind ?? null,
    walletId: row.walletId ?? null,
  }
}

function adaptLegacyPaidCallRow(row, agentsById) {
  const legacy = row.legacy ?? {}
  const paymentRail = legacy.paymentRail ?? null
  const isUmbra = paymentRail === 'umbra'
  const txHashFull = legacy.transactionSignature ?? null
  const chainId = legacy.chainId ?? row.value?.chainId ?? null
  const vendorLabel = legacy.vendorId ? humanizeToken(legacy.vendorId) : '—'

  return {
    id: row.id ?? legacy.executionId,
    transactionKind: 'legacy_paid_call',
    atMs: parseTimestamp(row.updatedAt || row.createdAt),
    createdAtMs: parseTimestamp(row.createdAt),
    timestamp: formatClock(row.updatedAt || row.createdAt),
    agentId: row.agentId,
    agentName: agentsById.get(row.agentId)?.name ?? humanizeToken(row.agentId),
    type: 'spend',
    action: isUmbra
      ? 'Umbra private settlement proof'
      : `${humanizeToken(legacy.serviceId)} via ${vendorLabel}`,
    amount: parseAmount(legacy.amount ?? row.value?.amount),
    assetSymbol: legacy.assetSymbol ?? row.value?.assetSymbol ?? 'PUSD',
    result: mapPaidCallResult({ status: row.status }),
    reason:
      row.errorMessage ??
      legacy.errorMessage ??
      humanizeToken(row.status),
    vendor: vendorLabel,
    vendorId: legacy.vendorId ?? null,
    serviceId: legacy.serviceId ?? null,
    paymentRail,
    umbraSettlement: null,
    chainId,
    txHash: shortTxHash(txHashFull),
    txHashFull,
    txExplorerUrl:
      legacy.transactionExplorerUrl ?? buildSolscanTxUrl(txHashFull, chainId),
    status: row.status,
    errorCode: legacy.errorCode ?? row.errorCode ?? null,
    errorMessage: legacy.errorMessage ?? row.errorMessage ?? null,
    settlementMode: deriveSettlementMode(
      { paymentRail, umbraSettlement: null, status: row.status },
      txHashFull,
    ),
    requiredApproval:
      row.status === 'approval_pending' ||
      row.status === 'waiting_for_execution',
  }
}

/**
 * Adapt the unified `/api/dashboard/transactions` projection rows into the same
 * spend-event shape that {@link adaptShowcaseSnapshot} produces, so the existing
 * Transactions list, filters, and detail lookup keep working unchanged. Field
 * selection branches on `transactionKind`: native rows read native fields,
 * legacy rows read the scoped `legacy.*` compatibility block.
 */
export function adaptDashboardTransactions(rows, options = {}) {
  const agents = options.agents ?? []
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))

  return (rows ?? [])
    .map((row) =>
      row?.transactionKind === 'native_wallet_action'
        ? adaptNativeWalletActionRow(row, agentsById)
        : adaptLegacyPaidCallRow(row, agentsById),
    )
    .sort((left, right) => right.atMs - left.atMs)
}

function buildApprovalAction(row) {
  if (row.transactionKind === 'native_wallet_action') {
    const target = row.targets?.target ?? {}
    if (row.approvalKind === 'asset.transfer' && target.kind === 'address') {
      const counterparty = target.counterpartyId
        ? humanizeToken(target.counterpartyId)
        : shortTxHash(target.address) ?? 'external address'
      return `Wallet transfer to ${counterparty}`
    }
    return row.title || humanizeToken(row.approvalKind)
  }

  const serviceId = row.targets?.serviceId
  const vendorLabel = row.targets?.vendorId
    ? humanizeToken(row.targets.vendorId)
    : '—'
  return serviceId
    ? `${humanizeToken(serviceId)} via ${vendorLabel}`
    : row.title || 'Service payment'
}

/**
 * Adapt the unified `/api/dashboard/approvals` projection rows into the same
 * pending-approval shape that {@link adaptShowcaseSnapshot} produces, so the
 * approval queue and nav badge keep working unchanged when sourced from the
 * dedicated route. Rows arrive newest-first; ordering is preserved.
 */
export function adaptDashboardApprovals(rows, options = {}) {
  const agents = options.agents ?? []
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))

  return (rows ?? []).map((row) => {
    const isNative = row.transactionKind === 'native_wallet_action'
    const counterpartyId = row.targets?.counterpartyId ?? null

    return {
      id: row.id,
      transactionKind: row.transactionKind,
      approvalKind: row.approvalKind,
      agentId: row.agentId,
      agentName: agentsById.get(row.agentId)?.name ?? humanizeToken(row.agentId),
      action: buildApprovalAction(row),
      vendor: isNative
        ? counterpartyId
          ? humanizeToken(counterpartyId)
          : humanizeToken(row.approvalKind)
        : row.targets?.vendorId
          ? humanizeToken(row.targets.vendorId)
          : '—',
      vendorId: row.targets?.vendorId ?? counterpartyId,
      serviceId: row.targets?.serviceId ?? null,
      assetSymbol: row.assetSymbol ?? 'PUSD',
      amount: parseAmount(row.amount),
      reason: row.reason ?? row.approval?.reason ?? null,
      createdAt: parseTimestamp(row.createdAt),
      xmtpSent: Boolean(row.xmtp?.requested),
      walletId: row.walletId ?? null,
    }
  })
}

export function adaptShowcaseSnapshot(snapshot) {
  const sortedSnapshots = [...(snapshot.agents ?? [])].sort(
    (left, right) =>
      parseTimestamp(left.agent?.createdAt) - parseTimestamp(right.agent?.createdAt),
  )
  const agents = sortedSnapshots.map(deriveAgent)
  // Snapshot events are now limited to legacy paid-call activity plus audit
  // alerts. Native wallet actions are read through /api/dashboard/transactions
  // and /api/dashboard/wallet-actions/:id instead.
  const events = sortedSnapshots
    .flatMap((agentSnapshot) => [
      ...(agentSnapshot.paidCalls ?? []).map((record) =>
        buildEvent(agentSnapshot, record),
      ),
      ...(agentSnapshot.xmtpAlerts ?? []).map((alertRecord) =>
        buildXmtpEvent(agentSnapshot, alertRecord),
      ),
    ])
    .sort((left, right) => right.atMs - left.atMs)

  const pendingApprovals = sortedSnapshots
    .flatMap((agentSnapshot) => {
      const agentName = agentSnapshot.agent?.displayName ?? humanizeToken(agentSnapshot.agent?.agentId)
      return (agentSnapshot.paidCalls ?? [])
        .filter(
          (record) =>
            record.status === 'approval_pending' ||
            record.status === 'waiting_for_execution',
        )
        .map((record) => {
          const alerts = getMatchingXMTPAlerts(agentSnapshot, record.executionId)
          return {
            id: record.executionId,
            agentId: record.agentId,
            agentName,
            action: buildActionLabel(agentSnapshot, record),
            vendor: getPolicyVendorLabel(agentSnapshot, record.vendorId),
            vendorId: record.vendorId ?? null,
            serviceId: record.serviceId ?? null,
            assetSymbol: record.assetSymbol ?? 'PUSD',
            amount: parseAmount(record.amount),
            reason: buildReason(agentSnapshot, record),
            createdAt: parseTimestamp(record.createdAt),
            xmtpSent: alerts.some(
              (item) =>
                item.type === 'approval.requested' && item.status === 'sent',
            ),
          }
        })
        .concat(
          (agentSnapshot.actionRequests ?? [])
            .filter((record) => record.status === 'approval_pending')
            .map((record) => {
              const counterpartyId = getActionRequestCounterpartyId(record)
              return {
                id: record.actionRequestId,
                agentId: record.agentId,
                agentName,
                action: buildActionRequestActionLabel(agentSnapshot, record),
                vendor: counterpartyId
                  ? getPolicyVendorLabel(agentSnapshot, counterpartyId)
                  : record.target?.kind === 'address'
                    ? shortTxHash(record.target.address)
                    : humanizeToken(record.target?.kind),
                vendorId: counterpartyId ?? null,
                serviceId: null,
                assetSymbol: getActionRequestAssetSymbol(record),
                amount: getActionRequestAmount(record),
                reason: buildActionRequestReason(record),
                createdAt: parseTimestamp(record.createdAt),
                xmtpSent: false,
                transactionKind: 'native_wallet_action',
                actionRequestKind: record.kind,
              }
            }),
        )
    })
    .sort((left, right) => right.createdAt - left.createdAt)

  const totalSpent = events
    .filter((event) => event.result === 'approved')
    .reduce((sum, event) => sum + (event.amount ?? 0), 0)

  return {
    source: 'live',
    headline: snapshot.headline,
    generatedAt: snapshot.generatedAt,
    agents,
    events,
    pendingApprovals,
    totalSpent,
    totalAgentCount: snapshot.summary?.agentCount ?? agents.length,
    activeCount: agents.filter((agent) => agent.status === 'active').length,
    pendingCount: pendingApprovals.length,
    summary: snapshot.summary ?? {},
  }
}
