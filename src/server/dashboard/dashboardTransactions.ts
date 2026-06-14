import type {
  ActionRequestKind,
  ActionRequestSource,
} from '../../store/ActionRequestRegistry.js'
import type { AgentRecord } from '../../store/AgentRegistry.js'
import type {
  PaidCallPaymentRail,
  PaidCallRecord,
  PaidCallSettlementMode,
  PaidCallStatus,
} from '../../store/PaidCallRegistry.js'
import type {
  PortfolioReader,
  WalletPortfolioTransaction,
} from '../../integrations/portfolio/types.js'
import type { AgentSpendWorkspace } from '../../workspace/loadWorkspace.js'
import {
  buildDashboardWalletActionHistory,
  type DashboardWalletAction,
} from './walletActions.js'

/**
 * Combined dashboard transaction projection.
 *
 * This is the single read model the dashboard "Transactions" view should move
 * to. It unions two sources without forcing one through the other:
 *
 *  - `legacy_paid_call`     — rows sourced directly from the PaidCall registry
 *                             (service / pay / PUSD / Umbra settlements).
 *  - `native_wallet_action` — rows sourced from the native wallet-action
 *                             history (wallet.create, wallet.policy_update,
 *                             asset.transfer, ...).
 *
 * Native wallet actions are NOT reshaped into paid-call rows. Legacy paid-call
 * compatibility fields are kept, but scoped under `legacy` so the dependency is
 * explicit and easy to remove once the dashboard fully switches over.
 */
export type DashboardTransactionKind =
  | 'legacy_paid_call'
  | 'native_wallet_action'
  | 'agent_event'

type DashboardTransactionValue = {
  assetSymbol: string
  amount: string
  chainId?: string
  valueUsd?: string
}

type DashboardTransactionBase = {
  transactionKind: DashboardTransactionKind
  id: string
  agentId: string
  walletId?: string
  status: string
  title: string
  summary: string
  createdAt: string
  updatedAt: string
  value?: DashboardTransactionValue
}

/**
 * Explicit, scoped compatibility surface for the legacy PaidCall-shaped
 * dashboard. Everything the current "Paid Calls / Transactions" table reads
 * lives here so the switch-over can drop this block wholesale.
 */
export type DashboardLegacyPaidCallTransaction = DashboardTransactionBase & {
  transactionKind: 'legacy_paid_call'
  source?: ActionRequestSource
  status: PaidCallStatus
  legacy: {
    executionId: string
    serviceId: string
    vendorId: string
    paymentRail: PaidCallPaymentRail
    settlementMode?: PaidCallSettlementMode
    assetSymbol: string
    amount: string
    chainId?: string
    transactionSignature?: string
    transactionExplorerUrl?: string
    runId?: string
    sessionId?: string
    errorCode?: string
    errorMessage?: string
  }
}

export type DashboardNativeWalletActionTransaction = DashboardTransactionBase & {
  transactionKind: 'native_wallet_action'
  actionRequestKind: ActionRequestKind
  walletActionId: string
  actionRequestId: string
  source: ActionRequestSource
  target: DashboardWalletAction['target']
  approval: DashboardWalletAction['approval']
  resultRef?: string
  transactionRef?: string
  errorCode?: string
  errorMessage?: string
  runtime: {
    connectorKind?: string
    connectorId?: string
    executionMode?: string
    privacyMode?: string
    runId?: string
    sessionId?: string
    intentIds: string[]
    simulationRefs: string[]
    broadcastRefs: string[]
  }
  mantle?: DashboardWalletAction['mantle']
}

/**
 * Timeline events that are NOT governed wallet actions or paid calls, but still
 * belong in the activity feed: an agent first coming online, an inbound deposit
 * detected on-chain. These are derived at read time from stable agent fields
 * and live wallet reads, so they never enter the ActionRequest lifecycle.
 */
export type DashboardAgentEventTransaction = DashboardTransactionBase & {
  transactionKind: 'agent_event'
  eventType: 'agent.connected' | 'deposit.detected'
}

export type DashboardTransactionRow =
  | DashboardLegacyPaidCallTransaction
  | DashboardNativeWalletActionTransaction
  | DashboardAgentEventTransaction

export const DASHBOARD_TRANSACTION_KINDS = [
  'legacy_paid_call',
  'native_wallet_action',
  'agent_event',
] as const satisfies readonly DashboardTransactionKind[]

export type DashboardTransactionsSummary = {
  totalMatching: number
  returned: number
  byTransactionKind: Record<DashboardTransactionKind, number>
  byStatus: Record<string, number>
  byActionRequestKind: Partial<Record<ActionRequestKind, number>>
  byLegacySettlementMode: Record<string, number>
}

export type DashboardTransactions = {
  projectionMode: 'shadow' | 'transactional_mirror'
  summary: DashboardTransactionsSummary
  transactions: DashboardTransactionRow[]
}

export type DashboardTransactionsQuery = {
  agentId?: string
  walletId?: string
  transactionKind?: DashboardTransactionKind
  limit?: number
}

// Upper bound on rows pulled from each underlying source before the combined
// list is sorted and capped. Mirrors the wallet-action history internal cap.
const SOURCE_SCAN_LIMIT = 500
const DEFAULT_TRANSACTION_LIMIT = 20

function sortByRecency(
  left: DashboardTransactionRow,
  right: DashboardTransactionRow,
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.id.localeCompare(left.id)
  )
}

function projectPaidCallTransaction(
  record: PaidCallRecord,
): DashboardLegacyPaidCallTransaction {
  return {
    transactionKind: 'legacy_paid_call',
    id: record.executionId,
    agentId: record.agentId,
    walletId: record.walletId,
    status: record.status,
    source: record.requestSource,
    title: `Service payment ${record.serviceId}`,
    summary: record.errorMessage
      ? record.errorMessage
      : `${record.amount} ${record.assetSymbol} for ${record.serviceId} via ${record.paymentRail}.`,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    value: {
      assetSymbol: record.assetSymbol,
      amount: record.amount,
      chainId: record.chainId,
    },
    legacy: {
      executionId: record.executionId,
      serviceId: record.serviceId,
      vendorId: record.vendorId,
      paymentRail: record.paymentRail,
      settlementMode: record.settlementMode,
      assetSymbol: record.assetSymbol,
      amount: record.amount,
      chainId: record.chainId,
      transactionSignature: record.transactionSignature,
      transactionExplorerUrl: record.transactionExplorerUrl,
      runId: record.runId,
      sessionId: record.sessionId,
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
    },
  }
}

function projectNativeWalletActionTransaction(
  action: DashboardWalletAction,
): DashboardNativeWalletActionTransaction {
  return {
    transactionKind: 'native_wallet_action',
    id: action.walletActionId,
    agentId: action.agentId,
    walletId: action.walletId,
    status: action.status,
    title: action.title,
    summary: action.summary,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
    value: action.value
      ? {
          assetSymbol: action.value.assetSymbol,
          amount: action.value.amount,
          chainId: action.value.chainId,
          valueUsd: action.value.valueUsd,
        }
      : undefined,
    actionRequestKind: action.kind,
    walletActionId: action.walletActionId,
    actionRequestId: action.actionRequestId,
    source: action.source,
    target: action.target,
    approval: action.approval,
    resultRef: action.execution.resultRef,
    transactionRef: action.execution.transactionRef,
    errorCode: action.execution.errorCode,
    errorMessage: action.execution.errorMessage,
    runtime: {
      connectorKind: action.execution.connectorKind,
      connectorId: action.execution.connectorId,
      executionMode: action.execution.executionMode,
      privacyMode: action.execution.privacyMode,
      runId: action.execution.runId,
      sessionId: action.execution.sessionId,
      intentIds: action.execution.intentIds,
      simulationRefs: action.execution.simulationRefs,
      broadcastRefs: action.execution.broadcastRefs,
    },
    mantle: action.mantle,
  }
}

// "Agent connected" timeline row, derived from the agent's first-connect stamp.
function projectAgentConnectedTransaction(
  agent: AgentRecord,
  at: string,
): DashboardAgentEventTransaction {
  return {
    transactionKind: 'agent_event',
    id: `agent_connected:${agent.agentId}`,
    agentId: agent.agentId,
    walletId: agent.walletId,
    status: 'connected',
    title: 'Agent connected',
    summary: `${agent.displayName} authenticated and came online.`,
    createdAt: at,
    updatedAt: at,
    eventType: 'agent.connected',
  }
}

function formatTokenAmount(quantity: number): string {
  return quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

// "Funding detected" timeline row for a single inbound credit of one asset.
// An inbound deposit is an external on-chain credit, not a governed action, so
// this surfaces funding without inventing a fake ActionRequest.
function projectDepositTransaction(input: {
  agent: AgentRecord
  transactionId: string
  at: string
  symbol: string
  amount: number
}): DashboardAgentEventTransaction {
  return {
    transactionKind: 'agent_event',
    id: `deposit:${input.agent.agentId}:${input.transactionId}`,
    agentId: input.agent.agentId,
    walletId: input.agent.walletId,
    status: 'detected',
    title: 'Funding detected',
    summary: `${input.agent.displayName} received ${formatTokenAmount(input.amount)} ${input.symbol} on-chain.`,
    value: { assetSymbol: input.symbol, amount: String(input.amount) },
    createdAt: input.at,
    updatedAt: input.at,
    eventType: 'deposit.detected',
  }
}

export function deriveLiveDepositEvents(
  agent: AgentRecord,
  transactions: WalletPortfolioTransaction[],
): DashboardAgentEventTransaction[] {
  return transactions
    .filter(
      (transaction) =>
        transaction.operationType === 'deposit' &&
        transaction.direction === 'in' &&
        typeof transaction.amount === 'number' &&
        Number.isFinite(transaction.amount) &&
        transaction.amount > 0 &&
        typeof transaction.assetSymbol === 'string' &&
        transaction.assetSymbol.length > 0 &&
        typeof transaction.minedAt === 'string' &&
        transaction.minedAt.length > 0,
    )
    .map((transaction) =>
      projectDepositTransaction({
        agent,
        transactionId:
          transaction.id ??
          transaction.hash ??
          `${transaction.minedAt}:${transaction.assetSymbol}:${transaction.amount}`,
        at: transaction.minedAt as string,
        symbol: transaction.assetSymbol as string,
        amount: transaction.amount as number,
      }),
    )
}

export async function buildDashboardTransactions(input: {
  workspace: AgentSpendWorkspace
  portfolioReader?: PortfolioReader
  query?: DashboardTransactionsQuery
}): Promise<DashboardTransactions> {
  const query = input.query ?? {}
  const limit = query.limit ?? DEFAULT_TRANSACTION_LIMIT
  const includeNative =
    !query.transactionKind || query.transactionKind === 'native_wallet_action'
  const includeLegacy =
    !query.transactionKind || query.transactionKind === 'legacy_paid_call'
  const includeEvents =
    !query.transactionKind || query.transactionKind === 'agent_event'

  // Native wallet actions are intentionally read through the dedicated
  // wallet-action history projection, never re-derived from paid calls. The
  // history already excludes service.pay rows, so it never overlaps with the
  // PaidCall source below.
  const walletActionHistory =
    includeNative && input.workspace.actionRequestRegistry
      ? await buildDashboardWalletActionHistory({
          workspace: input.workspace,
          query: {
            agentId: query.agentId,
            walletId: query.walletId,
            limit: SOURCE_SCAN_LIMIT,
          },
        })
      : undefined

  const nativeRows = (walletActionHistory?.walletActions ?? []).map(
    projectNativeWalletActionTransaction,
  )
  const nativeIds = new Set(nativeRows.map((row) => row.id))

  const legacyRows = includeLegacy
    ? (await input.workspace.paidCallRegistry.list())
        .filter((record) => {
          if (query.agentId && record.agentId !== query.agentId) {
            return false
          }
          if (query.walletId && record.walletId !== query.walletId) {
            return false
          }
          // Guard against double counting: if a native wallet action already
          // represents this id, prefer the native row.
          return !nativeIds.has(record.executionId)
        })
        .map(projectPaidCallTransaction)
    : []

  // Agent timeline events (read-time derived from stable agent fields; no
  // separate store). An agent can contribute more than one: its "connected"
  // moment (firstConnectedAt) and its "funded" moment (firstFundedAt).
  const agentEventRows: DashboardAgentEventTransaction[] = []
  if (includeEvents && input.workspace.agentRegistry) {
    const agents = (await input.workspace.agentRegistry.list()).filter(
      (agent) => {
        if (query.agentId && agent.agentId !== query.agentId) {
          return false
        }
        if (query.walletId && agent.walletId !== query.walletId) {
          return false
        }
        return true
      },
    )
    for (const agent of agents) {
      if (agent.firstConnectedAt) {
        agentEventRows.push(
          projectAgentConnectedTransaction(agent, agent.firstConnectedAt),
        )
      }
    }

    // Inbound deposits come from the live portfolio reader's recent on-chain
    // transaction classification, not from snapshot-diff heuristics. Snapshots
    // remain historical/audit state only.
    if (input.portfolioReader && input.workspace.walletRegistry) {
      for (const agent of agents) {
        const wallet = agent.walletId
          ? await input.workspace.walletRegistry.get(agent.walletId)
          : undefined
        const address = wallet?.address?.trim() ?? ''
        if (!address) {
          continue
        }
        const snapshot = await input.portfolioReader.getWalletSnapshot(address, {
          chainId: agent.policyConfig.allowedChains?.[0],
        })
        agentEventRows.push(
          ...deriveLiveDepositEvents(agent, snapshot.transactions),
        )
      }
    }
  }

  const combined = [...nativeRows, ...legacyRows, ...agentEventRows].sort(
    sortByRecency,
  )

  // Breakdowns are computed over the full matching set (pre-limit), matching
  // the wallet-action / action-request history projections.
  const byTransactionKind: Record<DashboardTransactionKind, number> = {
    legacy_paid_call: 0,
    native_wallet_action: 0,
    agent_event: 0,
  }
  const byStatus: Record<string, number> = {}
  const byActionRequestKind: Partial<Record<ActionRequestKind, number>> = {}
  const byLegacySettlementMode: Record<string, number> = {}

  for (const row of combined) {
    byTransactionKind[row.transactionKind] += 1
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
    if (row.transactionKind === 'native_wallet_action') {
      byActionRequestKind[row.actionRequestKind] =
        (byActionRequestKind[row.actionRequestKind] ?? 0) + 1
    } else if (row.transactionKind === 'legacy_paid_call') {
      const mode = row.legacy.settlementMode ?? 'unknown'
      byLegacySettlementMode[mode] = (byLegacySettlementMode[mode] ?? 0) + 1
    }
  }

  return {
    projectionMode:
      input.workspace.storageDriver === 'postgres'
        ? 'transactional_mirror'
        : 'shadow',
    summary: {
      totalMatching: combined.length,
      returned: Math.min(combined.length, limit),
      byTransactionKind,
      byStatus,
      byActionRequestKind,
      byLegacySettlementMode,
    },
    transactions: combined.slice(0, limit),
  }
}
