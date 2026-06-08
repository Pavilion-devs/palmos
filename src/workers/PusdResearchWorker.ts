import { buildAgentAuditSnapshot, type AgentAuditSnapshot } from '../audit/buildAgentAuditSnapshot.js'
import { executePaidServiceCall, type ExecutePaidServiceCallResult } from '../app/executePaidServiceCall.js'
import type { OpenAIResearchAgent, ResearchAgentAnswer, ResearchAgentPlan } from '../agents/OpenAIResearchAgent.js'
import type { PalmosClient } from '../integrations/pusd/client.js'
import type { PalmosServiceCatalog } from '../integrations/pusd/serviceCatalog.js'
import type { OwsClient } from '../integrations/ows/client.js'
import type { XmtpNotifier } from '../integrations/xmtp/client.js'
import type { AgentRecord } from '../store/AgentRegistry.js'
import type { AgentSpendWorkspace } from '../workspace/loadWorkspace.js'

export type PusdResearchWorkerInput = {
  baseDir: string
  env?: Record<string, string | undefined>
  workspace: AgentSpendWorkspace
  palmosClient: PalmosClient
  serviceCatalog: PalmosServiceCatalog
  owsClient?: OwsClient
  xmtpNotifier?: XmtpNotifier
  brain?: OpenAIResearchAgent
  agentId?: string
  task?: string
}

export type PusdResearchWorkerResult = {
  ok: true
  baseDir: string
  agent: AgentRecord
  task: string
  plan: ResearchAgentPlan
  execution: ExecutePaidServiceCallResult
  summary?: ResearchAgentAnswer
  audit: {
    current: AgentAuditSnapshot['current']
    paidCallSummary: AgentAuditSnapshot['paidCallSummary']
    latestTimeline: AgentAuditSnapshot['timeline']
  }
}

function defaultTask(): string {
  return 'Get the current BTC price in USD using the paid PalmOS market data service and summarize it.'
}

function createFallbackPlan(): ResearchAgentPlan {
  return {
    kind: 'service_call',
    serviceId: 'palmos.intel.onchain_flow',
    request: {
      base: 'BTC',
      quote: 'USD',
    },
    rationale:
      'Fallback worker plan: use the PalmOS PUSD-protected market intelligence service for the requested lookup.',
  }
}

async function selectWorkerAgent(input: {
  workspace: AgentSpendWorkspace
  agentId?: string
}): Promise<AgentRecord> {
  const agents = await input.workspace.agentRegistry.list()
  if (input.agentId) {
    const agent = agents.find((candidate) => candidate.agentId === input.agentId)
    if (!agent) {
      throw new Error(`Agent ${input.agentId} is not available for the PalmOS worker.`)
    }

    return agent
  }

  if (agents.length === 1) {
    const [agent] = agents
    if (agent) {
      return agent
    }
  }

  if (agents.length === 0) {
    throw new Error('No agent is available for the PalmOS worker.')
  }

  throw new Error('Select an agent before running the PalmOS worker.')
}

export async function runPusdResearchWorker(
  input: PusdResearchWorkerInput,
): Promise<PusdResearchWorkerResult> {
  const agent = await selectWorkerAgent({
    workspace: input.workspace,
    agentId: input.agentId,
  })
  const task = input.task?.trim() || defaultTask()
  const plan =
    input.brain != null
      ? await input.brain.planTask({
          agent,
          task,
          serviceCatalog: input.serviceCatalog,
        })
      : createFallbackPlan()

  const execution =
    plan.kind === 'service_call'
      ? await executePaidServiceCall(
          {
            kernel: input.workspace.kernel,
            agentRegistry: input.workspace.agentRegistry,
            actionRequests: input.workspace.actionRequestRegistry,
            paidCalls: input.workspace.paidCallRegistry,
            palmosClient: input.palmosClient,
            owsClient: input.owsClient,
            serviceCatalog: input.serviceCatalog,
            xmtpNotifier: input.xmtpNotifier,
            env: input.env,
          },
          {
            agentId: agent.agentId,
            serviceId: plan.serviceId,
            request: plan.request,
            source: 'worker',
          },
        )
      : await Promise.resolve({
          kind: 'blocked' as const,
          agent,
          execution: {
            executionId: `worker_no_action_${Date.now().toString(36)}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            agentId: agent.agentId,
            serviceId: 'none',
            vendorId: 'none',
            paymentRail: 'palmos-pusd' as const,
            amount: '0',
            assetSymbol: 'PUSD',
            chainId: 'solana-mainnet',
            status: 'blocked' as const,
            requestPayload: {},
            requestSummary: {
              rationale: plan.rationale,
            },
          },
          reason: plan.rationale,
        })

  const summary =
    input.brain != null && execution.kind === 'executed'
      ? await input.brain.summarizeResult({
          task,
          serviceResult: execution.execution.responsePreview,
        })
      : undefined

  const audit = await buildAgentAuditSnapshot({
    baseDir: input.baseDir,
    agentId: agent.agentId,
  })

  return {
    ok: true,
    baseDir: input.baseDir,
    agent,
    task,
    plan,
    execution,
    summary,
    audit: {
      current: audit.current,
      paidCallSummary: audit.paidCallSummary,
      latestTimeline: audit.timeline.slice(-8),
    },
  }
}
