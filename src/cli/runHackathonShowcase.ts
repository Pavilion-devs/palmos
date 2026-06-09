import {
  buildAgentAuditSnapshot,
  buildShowcaseSnapshot,
  createDefaultPalmosServiceCatalog,
  executePaidServiceCall,
  loadAgentSpendWorkspace,
  OwsClient,
  OpenAIResearchAgent,
  PalmosClient,
  readLocalPusdServerConfigFromEnv,
  resolvePendingPaidCallApproval,
  runDeadMansSwitchSweep,
  startLocalPusdDemoServer,
  XmtpNotifier,
  SolanaPortfolioReader,
} from '../index.js'
import { DEMO_AGENT_IDS, seedDemo } from '../demo/seedDemo.js'
import { writeShowcaseSnapshot } from '../projections/buildShowcaseSnapshot.js'
import { renderDashboardHtml } from '../ui/renderDashboardHtml.js'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

const env = readProcessEnv()
const baseDir =
  env.AGENT_SPEND_OS_BASE_DIR?.trim() ||
  `/tmp/palmos-showcase-${Date.now().toString(36)}`
const shouldStartLocalServer = env.START_LOCAL_PUSD_SERVER !== '0'
const shouldAutoResolveApprovals =
  env.SHOWCASE_AUTO_RESOLVE_APPROVALS !== '0'

let localServer: Awaited<ReturnType<typeof startLocalPusdDemoServer>> | undefined
if (shouldStartLocalServer) {
  const serverConfig = readLocalPusdServerConfigFromEnv(env)
  localServer = await startLocalPusdDemoServer(serverConfig)
  process.env.PUSD_MERCHANT_WALLET = localServer.payToAddress
}

const localDemoBaseUrl = shouldStartLocalServer
  ? `http://127.0.0.1:${localServer?.port ?? 4021}`
  : env.PUSD_DEMO_SERVER_BASE_URL?.trim() || 'http://127.0.0.1:4021'

const seedResult = await seedDemo({
  baseDir,
  organizationId: env.PALMOS_ORG_ID?.trim() || 'palmos_showcase_workspace',
  treasuryId: env.PALMOS_TREASURY_ID?.trim() || 'palmos_showcase_treasury',
})
const workspace = loadAgentSpendWorkspace({
  baseDir,
})
const palmosClient = PalmosClient.fromEnv(env)
const owsClient = workspace.owsClient ?? OwsClient.fromEnv(baseDir, env)

const serviceCatalog = createDefaultPalmosServiceCatalog({
  localDemoBaseUrl,
  localDemoSpotPriceAmount: env.PUSD_DEMO_SPOT_PRICE,
  localDemoOpsBriefAmount: env.PUSD_DEMO_OPS_BRIEF_PRICE,
})
const xmtpNotifier = XmtpNotifier.fromEnv(
  {
    ...env,
    XMTP_DB_PATH: env.XMTP_DB_PATH?.trim() || join(baseDir, 'xmtp-local.db3'),
  },
  workspace.xmtpAlertRegistry,
)

const marketMonitorAgent = seedResult.agents.find(
  (agent) => agent.agentId === DEMO_AGENT_IDS.marketMonitor,
)
const vendorProcurementAgent = seedResult.agents.find(
  (agent) => agent.agentId === DEMO_AGENT_IDS.vendorProcurement,
)
const growthCampaignAgent = seedResult.agents.find(
  (agent) => agent.agentId === DEMO_AGENT_IDS.growthCampaign,
)

if (!marketMonitorAgent || !vendorProcurementAgent || !growthCampaignAgent) {
  throw new Error('Showcase seed did not create all expected demo agents.')
}

const brain = OpenAIResearchAgent.fromEnv(env)
if (!brain) {
  throw new Error('OPENAI_API_KEY is required for the showcase run.')
}

const marketPlan = await brain.planTask({
  agent: marketMonitorAgent,
  task: 'Get the current BTC price in USD using the paid market data service and summarize it.',
  serviceCatalog,
})

const marketExecution =
  marketPlan.kind === 'service_call'
    ? await executePaidServiceCall(
        {
          kernel: workspace.kernel,
          agentRegistry: workspace.agentRegistry,
          actionRequests: workspace.actionRequestRegistry,
          paidCalls: workspace.paidCallRegistry,
          palmosClient,
          owsClient,
          serviceCatalog,
          xmtpNotifier,
          env,
        },
        {
          agentId: marketMonitorAgent.agentId,
          serviceId: marketPlan.serviceId,
          request: marketPlan.request,
          source: 'system',
        },
      )
    : undefined

const procurementSubmitted = await executePaidServiceCall(
  {
    kernel: workspace.kernel,
    agentRegistry: workspace.agentRegistry,
    actionRequests: workspace.actionRequestRegistry,
    paidCalls: workspace.paidCallRegistry,
    palmosClient,
    owsClient,
    serviceCatalog,
    xmtpNotifier,
    env,
  },
  {
    agentId: vendorProcurementAgent.agentId,
    serviceId: 'palmos.research.defi_risk',
    source: 'system',
    request: {
      symbols: ['BTC', 'ETH', 'SOL'],
      focus: 'ops market pulse',
    },
  },
)

const procurementApproved =
  shouldAutoResolveApprovals && procurementSubmitted.kind === 'approval_pending'
    ? await resolvePendingPaidCallApproval(
        {
          kernel: workspace.kernel,
          agentRegistry: workspace.agentRegistry,
          paidCalls: workspace.paidCallRegistry,
          palmosClient,
          owsClient,
          serviceCatalog,
          xmtpNotifier,
        },
        {
          executionId: procurementSubmitted.execution.executionId,
          decision: 'approved',
          approverActorId: 'manager_dashboard',
          approverRole: 'manager',
          comment: 'Approved during packaged showcase run.',
        },
      )
    : procurementSubmitted

const growthCampaignBlocked = await executePaidServiceCall(
  {
    kernel: workspace.kernel,
    agentRegistry: workspace.agentRegistry,
    actionRequests: workspace.actionRequestRegistry,
    paidCalls: workspace.paidCallRegistry,
    palmosClient,
    owsClient,
    serviceCatalog,
    xmtpNotifier,
    env,
  },
  {
    agentId: growthCampaignAgent.agentId,
    serviceId: 'palmos.research.defi_risk',
    source: 'system',
    request: {
      symbols: ['BTC', 'ETH'],
      focus: 'growth budget check',
    },
  },
)

const currentMarketMonitorAgent = await workspace.agentRegistry.get(
  marketMonitorAgent.agentId,
)
if (currentMarketMonitorAgent) {
  const staleAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  await workspace.agentRegistry.put({
    ...currentMarketMonitorAgent,
    updatedAt: staleAt,
    lastCheckInAt: staleAt,
  })
}

const deadMansSwitch = await runDeadMansSwitchSweep(
  {
    agentRegistry: workspace.agentRegistry,
    walletRegistry: workspace.walletRegistry,
    controlEvents: workspace.controlEventRegistry,
    runs: workspace.runRegistry,
    kernel: workspace.kernel,
    xmtpNotifier,
  },
  {
    organizationId: env.PALMOS_ORG_ID?.trim() || 'palmos_showcase_workspace',
  },
)

const snapshot = await buildShowcaseSnapshot({
  baseDir,
  portfolioReader: SolanaPortfolioReader.fromEnv(env),
})
const dashboardDir = join(baseDir, 'dashboard')
await mkdir(dashboardDir, { recursive: true })
const dashboardHtmlPath = join(dashboardDir, 'index.html')
await writeFile(dashboardHtmlPath, renderDashboardHtml(snapshot), 'utf8')
const dashboardJsonPath = await writeShowcaseSnapshot({
  baseDir,
  snapshot,
})

const marketAudit = await buildAgentAuditSnapshot({
  baseDir,
  agentId: marketMonitorAgent.agentId,
})
const procurementAudit = await buildAgentAuditSnapshot({
  baseDir,
  agentId: vendorProcurementAgent.agentId,
})
const growthCampaignAudit = await buildAgentAuditSnapshot({
  baseDir,
  agentId: growthCampaignAgent.agentId,
})

console.log(
  JSON.stringify(
    {
      ok: true,
      baseDir,
      autoResolvedApprovals: shouldAutoResolveApprovals,
      services: {
        localDemoBaseUrl,
        spotPriceAmount: env.PUSD_DEMO_SPOT_PRICE ?? '0.01',
        opsBriefPriceAmount: env.PUSD_DEMO_OPS_BRIEF_PRICE ?? '0.25',
      },
      outcomes: {
        marketMonitor: marketExecution?.kind,
        vendorProcurementSubmission: procurementSubmitted.kind,
        vendorProcurementResolution: procurementApproved.kind,
        growthCampaign: growthCampaignBlocked.kind,
        deadMansSwitch,
      },
      agents: {
        marketMonitor: marketAudit.current,
        vendorProcurement: procurementAudit.current,
        growthCampaign: growthCampaignAudit.current,
      },
      dashboard: {
        htmlPath: dashboardHtmlPath,
        jsonPath: dashboardJsonPath,
      },
    },
    null,
    2,
  ),
)

if (localServer) {
  await localServer.close()
}
