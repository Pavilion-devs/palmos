import { readFile, readdir } from 'fs/promises'
import type { AgentRecord, AgentRegistry } from '../store/AgentRegistry.js'
import { FileAgentRegistry } from '../store/AgentRegistry.js'
import {
  FileAgentControlEventRegistry,
  type AgentControlEventRecord,
  type AgentControlEventRegistry,
} from '../store/AgentControlEventRegistry.js'
import {
  FilePaidCallRegistry,
  type PaidCallRecord,
  type PaidCallRegistry,
} from '../store/PaidCallRegistry.js'
import {
  FileXMTPAlertRegistry,
  type XMTPAlertRecord,
  type XMTPAlertRegistry,
} from '../store/XMTPAlertRegistry.js'
import { getRunLedgerEventsPath, getRunsDir } from '../../runtime/runtime/fileLayout.js'

export type AgentAuditEntry = {
  entryId: string
  at: string
  source:
    | 'agent_registry'
    | 'control_plane'
    | 'paid_call'
    | 'runtime_ledger'
    | 'xmtp_alert'
  status: 'info' | 'success' | 'warning' | 'error'
  title: string
  detail: string
  runId?: string
  phase?: string
  refs?: {
    agentId: string
    walletId?: string
    executionId?: string
  }
}

export type AgentAuditSnapshot = {
  agent: AgentRecord
  current: {
    status: AgentRecord['status']
    trustTier: AgentRecord['trustTier']
    walletId?: string
    walletState?: AgentRecord['walletState']
    signerProfileId?: string
    policyProfileId?: string
  }
  paidCallSummary: {
    total: number
    executed: number
    blocked: number
    approvalPending: number
    waitingForExecution: number
    failed: number
  }
  timeline: AgentAuditEntry[]
}

type LedgerEvent = {
  eventId: string
  eventType: string
  at: string
  sessionId: string
  runId?: string
  phase?: string
  summary?: string
  payload?: Record<string, unknown>
  refs?: {
    walletIds?: string[]
  }
}

function getPaidCallStatusCount(
  records: PaidCallRecord[],
  status: PaidCallRecord['status'],
): number {
  return records.filter((record) => record.status === status).length
}

function getRuntimeStatus(eventType: string): AgentAuditEntry['status'] {
  if (
    eventType.includes('failed') ||
    eventType.includes('rejected') ||
    eventType.includes('invalidated')
  ) {
    return 'error'
  }

  if (
    eventType.includes('waiting') ||
    eventType.includes('pending') ||
    eventType.includes('approval')
  ) {
    return 'warning'
  }

  if (
    eventType.includes('created') ||
    eventType.includes('resolved') ||
    eventType.includes('completed') ||
    eventType.includes('confirmed')
  ) {
    return 'success'
  }

  return 'info'
}

function getPaidCallStatus(record: PaidCallRecord): AgentAuditEntry['status'] {
  switch (record.status) {
    case 'executed':
      return 'success'
    case 'approval_pending':
    case 'waiting_for_execution':
      return 'warning'
    case 'blocked':
    case 'failed':
      return 'error'
    default:
      return 'info'
  }
}

async function readJsonLines<T>(path: string): Promise<T[]> {
  try {
    const contents = await readFile(path, 'utf8')
    return contents
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T)
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

function isEventRelevant(agent: AgentRecord, event: LedgerEvent): boolean {
  if (event.sessionId === agent.sessionId) {
    return true
  }

  const walletId = agent.walletId
  if (walletId) {
    if (event.refs?.walletIds?.includes(walletId)) {
      return true
    }

    if (event.payload?.walletId === walletId) {
      return true
    }
  }

  return event.payload?.subjectId === agent.agentId
}

function mapRuntimeEvent(agent: AgentRecord, event: LedgerEvent): AgentAuditEntry {
  return {
    entryId: `runtime:${event.eventId}`,
    at: event.at,
    source: 'runtime_ledger',
    status: getRuntimeStatus(event.eventType),
    title: event.eventType,
    detail: event.summary ?? `Runtime event ${event.eventType} recorded.`,
    runId: event.runId,
    phase: event.phase,
    refs: {
      agentId: agent.agentId,
      walletId: agent.walletId,
    },
  }
}

function mapPaidCall(agent: AgentRecord, record: PaidCallRecord): AgentAuditEntry {
  return {
    entryId: `paid_call:${record.executionId}`,
    at: record.updatedAt,
    source: 'paid_call',
    status: getPaidCallStatus(record),
    title: `paid_call.${record.status}`,
    detail:
      record.errorMessage ??
      `${record.serviceId} attempted via ${record.paymentRail} for ${record.amount} ${record.assetSymbol}.`,
    runId: record.runId,
    refs: {
      agentId: agent.agentId,
      walletId: record.walletId,
      executionId: record.executionId,
    },
  }
}

function mapControlEvent(
  agent: AgentRecord,
  record: AgentControlEventRecord,
): AgentAuditEntry {
  return {
    entryId: `control:${record.controlEventId}`,
    at: record.at,
    source: 'control_plane',
    status: record.status === 'applied' ? 'warning' : 'info',
    title: record.type,
    detail: record.summary,
    refs: {
      agentId: agent.agentId,
      walletId: record.refs?.walletId,
    },
  }
}

function getXmtpAlertStatus(record: XMTPAlertRecord): AgentAuditEntry['status'] {
  switch (record.status) {
    case 'sent':
      return 'success'
    case 'skipped':
      return 'warning'
    case 'failed':
      return 'error'
    default:
      return 'info'
  }
}

function mapXmtpAlert(
  agent: AgentRecord,
  record: XMTPAlertRecord,
): AgentAuditEntry {
  return {
    entryId: `xmtp:${record.alertId}`,
    at: record.updatedAt,
    source: 'xmtp_alert',
    status: getXmtpAlertStatus(record),
    title: `xmtp.${record.type}.${record.status}`,
    detail: record.reason ?? record.messagePreview,
    runId: record.runId,
    refs: {
      agentId: agent.agentId,
      walletId: agent.walletId,
      executionId: record.executionId,
    },
  }
}

export async function buildAgentAuditSnapshot(input: {
  baseDir: string
  agentId: string
  agentRegistry?: AgentRegistry
  controlEventRegistry?: AgentControlEventRegistry
  paidCallRegistry?: PaidCallRegistry
  xmtpAlertRegistry?: XMTPAlertRegistry
}): Promise<AgentAuditSnapshot> {
  const agentRegistry = input.agentRegistry ?? new FileAgentRegistry(input.baseDir)
  const controlEventRegistry =
    input.controlEventRegistry ?? new FileAgentControlEventRegistry(input.baseDir)
  const paidCallRegistry =
    input.paidCallRegistry ?? new FilePaidCallRegistry(input.baseDir)
  const xmtpAlertRegistry =
    input.xmtpAlertRegistry ?? new FileXMTPAlertRegistry(input.baseDir)

  const agent = await agentRegistry.get(input.agentId)
  if (!agent) {
    throw new Error(`Unknown agent: ${input.agentId}`)
  }

  const paidCalls = (await paidCallRegistry.list()).filter(
    (record) => record.agentId === input.agentId,
  )
  const controlEvents = (await controlEventRegistry.list()).filter(
    (record) => record.agentId === input.agentId,
  )
  const xmtpAlerts = (await xmtpAlertRegistry.list()).filter(
    (record) => record.agentId === input.agentId,
  )

  const runtimeEvents =
    input.agentRegistry ||
    input.controlEventRegistry ||
    input.paidCallRegistry ||
    input.xmtpAlertRegistry
      ? []
      : (
          await Promise.all(
            (
              await readdir(getRunsDir(input.baseDir), {
                withFileTypes: true,
              }).catch((error: unknown) => {
                if (
                  error instanceof Error &&
                  'code' in error &&
                  error.code === 'ENOENT'
                ) {
                  return []
                }

                throw error
              })
            )
              .filter((entry) => entry.isDirectory())
              .map((entry) =>
                readJsonLines<LedgerEvent>(
                  getRunLedgerEventsPath(entry.name, input.baseDir),
                ),
              ),
          )
        )
          .flat()
          .filter((event) => isEventRelevant(agent, event))

  const agentCreatedEntry: AgentAuditEntry = {
    entryId: `agent:${agent.agentId}:created`,
    at: agent.createdAt,
    source: 'agent_registry',
    status: 'info',
    title: 'agent.created',
    detail: `Agent ${agent.displayName} was registered with wallet type ${agent.walletType}.`,
    refs: {
      agentId: agent.agentId,
      walletId: agent.walletId,
    },
  }
  const timeline: AgentAuditEntry[] = [
    agentCreatedEntry,
    ...controlEvents.map((record) => mapControlEvent(agent, record)),
    ...xmtpAlerts.map((record) => mapXmtpAlert(agent, record)),
    ...runtimeEvents.map((event) => mapRuntimeEvent(agent, event)),
    ...paidCalls.map((record) => mapPaidCall(agent, record)),
  ].sort((left, right) => left.at.localeCompare(right.at))

  return {
    agent,
    current: {
      status: agent.status,
      trustTier: agent.trustTier,
      walletId: agent.walletId,
      walletState: agent.walletState,
      signerProfileId: agent.signerProfileId,
      policyProfileId: agent.policyProfileId,
    },
    paidCallSummary: {
      total: paidCalls.length,
      executed: getPaidCallStatusCount(paidCalls, 'executed'),
      blocked: getPaidCallStatusCount(paidCalls, 'blocked'),
      approvalPending: getPaidCallStatusCount(paidCalls, 'approval_pending'),
      waitingForExecution: getPaidCallStatusCount(
        paidCalls,
        'waiting_for_execution',
      ),
      failed: getPaidCallStatusCount(paidCalls, 'failed'),
    },
    timeline,
  }
}
