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

  if (record.serviceId === 'coingecko.simple_price') {
    return `Crypto data via ${vendorLabel}`
  }

  if (
    record.serviceId === 'local.demo.ops_brief' ||
    record.serviceId === 'local.pusd.ops_brief'
  ) {
    return `Ops brief via ${vendorLabel}`
  }

  if (
    record.serviceId === 'local.demo.spot_price' ||
    record.serviceId === 'local.pusd.spot_price'
  ) {
    return `Spot price query via ${vendorLabel}`
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

function buildZerionSummary(zerionSnapshot) {
  const positions = zerionSnapshot?.positions ?? []
  const transactions = zerionSnapshot?.transactions ?? []
  const sync = zerionSnapshot?.sync ?? {
    kind: 'disabled',
    message: 'Zerion enrichment is not configured on the backend.',
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
    walletAddress: zerionSnapshot?.address ?? null,
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

function formatZerionPortfolioDisplay(zerion) {
  if (zerion.syncKind === 'synced') {
    return `$${(zerion.portfolioValue ?? 0).toFixed(2)}`
  }

  if (zerion.syncKind === 'empty') {
    return 'no data'
  }

  if (zerion.syncKind === 'unsupported_chain' && zerion.syncChainId) {
    return `unsupported on ${zerion.syncChainId}`
  }

  if (zerion.syncKind === 'request_failed') {
    return 'sync failed'
  }

  if (zerion.syncKind === 'missing_wallet_address') {
    return 'wallet unavailable'
  }

  if (zerion.syncKind === 'disabled') {
    return 'disabled'
  }

  return 'unavailable'
}

function formatZerionLatestDisplay(zerion) {
  if (zerion.latestTransactionAt) {
    return `${zerion.latestTransactionAt}${zerion.latestTransactionChain ? ` · ${String(zerion.latestTransactionChain).toUpperCase()}` : ''}`
  }

  if (zerion.syncKind === 'unsupported_chain' && zerion.syncChainId) {
    return `unsupported on ${zerion.syncChainId}`
  }

  if (zerion.syncKind === 'empty') {
    return 'no data'
  }

  if (zerion.syncKind === 'request_failed') {
    return 'sync failed'
  }

  if (zerion.syncKind === 'missing_wallet_address') {
    return 'wallet unavailable'
  }

  if (zerion.syncKind === 'disabled') {
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
  const zerion = buildZerionSummary(agentSnapshot.zerion)
  const executedAmount = paidCalls
    .filter((record) => record.status === 'executed')
    .reduce((sum, record) => sum + parseAmount(record.amount), 0)
  const committedAmount = getCommittedSpend(paidCalls)
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
    executedSpend: executedAmount,
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
      executedSpend: executedAmount,
      committedSpend: committedAmount,
      blockedCount,
      zerionWalletAddress: zerion.walletAddress,
      zerionPositionsCount: zerion.positionsCount,
      zerionTransactionsCount: zerion.transactionsCount,
      zerionPortfolioValue: zerion.portfolioValue,
      zerionLatestTransactionAt: zerion.latestTransactionAt,
      zerionLatestTransactionChain: zerion.latestTransactionChain,
      zerionSyncKind: zerion.syncKind,
      zerionSyncMessage: zerion.syncMessage,
      zerionSyncChainId: zerion.syncChainId,
      zerionPortfolioDisplay: formatZerionPortfolioDisplay(zerion),
      zerionLatestDisplay: formatZerionLatestDisplay(zerion),
    },
  }
}

export function adaptShowcaseSnapshot(snapshot) {
  const sortedSnapshots = [...(snapshot.agents ?? [])].sort(
    (left, right) =>
      parseTimestamp(left.agent?.createdAt) - parseTimestamp(right.agent?.createdAt),
  )
  const agents = sortedSnapshots.map(deriveAgent)
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
