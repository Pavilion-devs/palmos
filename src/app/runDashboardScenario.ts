import { executePaidServiceCall } from './executePaidServiceCall.js'
import { buildShowcaseSnapshot } from '../projections/buildShowcaseSnapshot.js'
import { DEMO_AGENT_IDS, seedDemo } from '../demo/seedDemo.js'
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
    marketMonitor: string
    vendorProcurement: string
    growthCampaign: string
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
    organizationId: deps.env?.PALMOS_ORG_ID?.trim() || 'palmos_showcase_workspace',
    treasuryId: deps.env?.PALMOS_TREASURY_ID?.trim() || 'palmos_showcase_treasury',
  })

  const marketMonitorAgent = seeded.agents.find(
    (agent) => agent.agentId === DEMO_AGENT_IDS.marketMonitor,
  )
  const vendorProcurementAgent = seeded.agents.find(
    (agent) => agent.agentId === DEMO_AGENT_IDS.vendorProcurement,
  )
  const growthCampaignAgent = seeded.agents.find(
    (agent) => agent.agentId === DEMO_AGENT_IDS.growthCampaign,
  )

  if (!marketMonitorAgent || !vendorProcurementAgent || !growthCampaignAgent) {
    throw new Error('Dashboard scenario seed did not create all expected agents.')
  }

  const sharedDeps = {
    kernel: deps.workspace.kernel,
    agentRegistry: deps.workspace.agentRegistry,
    actionRequests: deps.workspace.actionRequestRegistry,
    paidCalls: deps.workspace.paidCallRegistry,
    palmosClient: deps.palmosClient,
    owsClient: deps.owsClient,
    serviceCatalog: deps.serviceCatalog,
    xmtpNotifier: deps.xmtpNotifier,
    env: deps.env,
  }

  const marketMonitor = await executePaidServiceCall(sharedDeps, {
    agentId: marketMonitorAgent.agentId,
    serviceId: 'palmos.intel.onchain_flow',
    source: 'system',
    request: {
      base: 'BTC',
      quote: 'USD',
    },
  })

  const vendorProcurement = await executePaidServiceCall(sharedDeps, {
    agentId: vendorProcurementAgent.agentId,
    serviceId: 'palmos.research.defi_risk',
    source: 'system',
    request: {
      symbols: ['BTC', 'ETH', 'SOL'],
      focus: 'ops market pulse',
    },
  })

  const growthCampaign = await executePaidServiceCall(sharedDeps, {
    agentId: growthCampaignAgent.agentId,
    serviceId: 'palmos.research.defi_risk',
    source: 'system',
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
      marketMonitor: marketMonitor.kind,
      vendorProcurement: vendorProcurement.kind,
      growthCampaign: growthCampaign.kind,
    },
  }
}
