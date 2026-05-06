import { executePaidServiceCall } from './executePaidServiceCall.js'
import { buildShowcaseSnapshot } from '../projections/buildShowcaseSnapshot.js'
import { seedDemo } from '../demo/seedDemo.js'
import type { PalmosClient } from '../integrations/pusd/client.js'
import type { OwsClient } from '../integrations/ows/client.js'
import type { XmtpNotifier } from '../integrations/xmtp/client.js'
import type { ZerionClient } from '../integrations/zerion/client.js'
import type { PalmosServiceCatalog } from '../integrations/pusd/serviceCatalog.js'
import type { AgentSpendWorkspace } from '../workspace/loadWorkspace.js'
import { resetAgentSpendWorkspace } from '../workspace/resetWorkspace.js'

export type RunDashboardScenarioDependencies = {
  baseDir: string
  env?: Record<string, string | undefined>
  workspace: AgentSpendWorkspace
  palmosClient?: PalmosClient
  owsClient?: OwsClient
  xmtpNotifier?: XmtpNotifier
  zerionClient?: ZerionClient
  serviceCatalog: PalmosServiceCatalog
}

export async function runDashboardScenario(
  deps: RunDashboardScenarioDependencies,
): Promise<{
  snapshot: Awaited<ReturnType<typeof buildShowcaseSnapshot>>
  outcomes: {
    research: string
    ops: string
    growth: string
  }
}> {
  if (!deps.palmosClient) {
    throw new Error(
      'PalmOS PUSD client config is required to run the live dashboard scenario.',
    )
  }

  await resetAgentSpendWorkspace({
    baseDir: deps.baseDir,
    env: deps.env,
  })

  const seeded = await seedDemo({
    baseDir: deps.baseDir,
    organizationId: 'org_demo',
    treasuryId: 'treasury_demo',
  })

  const researchAgent = seeded.agents.find(
    (agent) => agent.agentId === 'research_agent',
  )
  const opsAgent = seeded.agents.find((agent) => agent.agentId === 'ops_buyer')
  const growthAgent = seeded.agents.find(
    (agent) => agent.agentId === 'growth_agent',
  )

  if (!researchAgent || !opsAgent || !growthAgent) {
    throw new Error('Dashboard scenario seed did not create all expected agents.')
  }

  const sharedDeps = {
    kernel: deps.workspace.kernel,
    agentRegistry: deps.workspace.agentRegistry,
    paidCalls: deps.workspace.paidCallRegistry,
    palmosClient: deps.palmosClient,
    owsClient: deps.owsClient,
    serviceCatalog: deps.serviceCatalog,
    xmtpNotifier: deps.xmtpNotifier,
  }

  const research = await executePaidServiceCall(sharedDeps, {
    agentId: researchAgent.agentId,
    serviceId: 'local.pusd.spot_price',
    request: {
      base: 'BTC',
      quote: 'USD',
    },
  })

  const ops = await executePaidServiceCall(sharedDeps, {
    agentId: opsAgent.agentId,
    serviceId: 'local.pusd.ops_brief',
    request: {
      symbols: ['BTC', 'ETH', 'SOL'],
      focus: 'ops market pulse',
    },
  })

  const growth = await executePaidServiceCall(sharedDeps, {
    agentId: growthAgent.agentId,
    serviceId: 'local.pusd.ops_brief',
    request: {
      symbols: ['BTC', 'ETH'],
      focus: 'growth budget check',
    },
  })

  const snapshot = await buildShowcaseSnapshot({
    baseDir: deps.baseDir,
    zerionClient: deps.zerionClient,
  })

  return {
    snapshot,
    outcomes: {
      research: research.kind,
      ops: ops.kind,
      growth: growth.kind,
    },
  }
}
