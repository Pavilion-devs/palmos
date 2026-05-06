import type {
  RunRegistry,
  SessionKernel,
  WalletRegistry,
} from '../../runtime/index.js'
import type { XmtpNotifier } from '../integrations/xmtp/client.js'
import type { AgentRegistry } from '../store/AgentRegistry.js'
import type {
  AgentControlEventRecord,
  AgentControlEventRegistry,
} from '../store/AgentControlEventRegistry.js'

export type DeadMansSwitchSweepDependencies = {
  agentRegistry: AgentRegistry
  walletRegistry: WalletRegistry
  controlEvents?: AgentControlEventRegistry
  runs?: RunRegistry
  kernel?: SessionKernel
  xmtpNotifier?: XmtpNotifier
  now?: () => string
  createId?: (prefix: string) => string
}

export type DeadMansSwitchSweepInput = {
  organizationId?: string
}

export type DeadMansSwitchSweepResult = {
  checkedAt: string
  results: Array<{
    agentId: string
    action: 'noop' | 'suspended'
    staleBySeconds: number
    walletId?: string
    haltedRunIds: string[]
  }>
}

function createControlEventId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function getSecondsSince(older: string, newer: string): number {
  const olderMs = Date.parse(older)
  const newerMs = Date.parse(newer)

  if (!Number.isFinite(olderMs) || !Number.isFinite(newerMs)) {
    return 0
  }

  return Math.max(0, Math.floor((newerMs - olderMs) / 1000))
}

function shouldHaltRun(status: string): boolean {
  return (
    status === 'active' ||
    status === 'waiting_for_approval' ||
    status === 'waiting_for_signature' ||
    status === 'waiting_for_confirmation'
  )
}

export async function runDeadMansSwitchSweep(
  deps: DeadMansSwitchSweepDependencies,
  input: DeadMansSwitchSweepInput = {},
): Promise<DeadMansSwitchSweepResult> {
  const checkedAt = deps.now?.() ?? new Date().toISOString()
  const agents = await deps.agentRegistry.list()
  const scopedAgents = input.organizationId
    ? agents.filter((agent) => agent.organizationId === input.organizationId)
    : agents

  const results: DeadMansSwitchSweepResult['results'] = []

  for (const agent of scopedAgents) {
    const timeoutSeconds = agent.policyConfig.heartbeatTimeoutSeconds
    const staleBySeconds = getSecondsSince(agent.lastCheckInAt, checkedAt)

    if (staleBySeconds < timeoutSeconds || agent.status === 'stale') {
      results.push({
        agentId: agent.agentId,
        action: 'noop',
        staleBySeconds,
        walletId: agent.walletId,
        haltedRunIds: [],
      })
      continue
    }

    const haltedRunIds: string[] = []
    if (deps.kernel && deps.runs) {
      const runs = await deps.runs.listBySession(agent.sessionId)
      for (const run of runs) {
        if (shouldHaltRun(run.status)) {
          await deps.kernel.haltRun(
            run.runId,
            'Dead man switch triggered because the agent heartbeat expired.',
          )
          haltedRunIds.push(run.runId)
        }
      }
    }

    if (agent.walletId) {
      const wallet = await deps.walletRegistry.get(agent.walletId)
      if (wallet) {
        await deps.walletRegistry.put({
          ...wallet,
          updatedAt: checkedAt,
          state: 'suspended',
          policyAttachmentStatus: 'stale',
          trustStatus: 'manual_review',
        })
      }
    }

    await deps.agentRegistry.put({
      ...agent,
      updatedAt: checkedAt,
      status: 'stale',
      walletState: agent.walletId ? 'suspended' : agent.walletState,
    })

    const controlEvent: AgentControlEventRecord = {
      controlEventId:
        deps.createId?.('control_event') ??
        createControlEventId('control_event'),
      at: checkedAt,
      agentId: agent.agentId,
      type: 'dead_man_switch.triggered',
      status: 'applied',
      summary:
        'Dead man switch suspended the agent wallet after heartbeat expiry.',
      refs: {
        walletId: agent.walletId,
        haltedRunIds,
      },
      metadata: {
        staleBySeconds,
        heartbeatTimeoutSeconds: timeoutSeconds,
      },
    }
    await deps.controlEvents?.put(controlEvent)
    await deps.xmtpNotifier?.sendDeadManSwitchTriggered({
      agent: {
        ...agent,
        updatedAt: checkedAt,
        status: 'stale',
        walletState: agent.walletId ? 'suspended' : agent.walletState,
      },
      controlEvent,
    })

    results.push({
      agentId: agent.agentId,
      action: 'suspended',
      staleBySeconds,
      walletId: agent.walletId,
      haltedRunIds,
    })
  }

  return {
    checkedAt,
    results,
  }
}
