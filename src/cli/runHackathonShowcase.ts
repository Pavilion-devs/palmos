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
  seedDemo,
  startLocalPusdDemoServer,
  XmtpNotifier,
  ZerionClient,
} from '../index.js'
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
  organizationId: 'org_demo',
  treasuryId: 'treasury_demo',
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

const researchAgent = seedResult.agents.find((agent) => agent.agentId === 'research_agent')
const opsAgent = seedResult.agents.find((agent) => agent.agentId === 'ops_buyer')
const growthAgent = seedResult.agents.find((agent) => agent.agentId === 'growth_agent')

if (!researchAgent || !opsAgent || !growthAgent) {
  throw new Error('Showcase seed did not create all expected demo agents.')
}

const brain = OpenAIResearchAgent.fromEnv(env)
if (!brain) {
  throw new Error('OPENAI_API_KEY is required for the showcase run.')
}

const researchPlan = await brain.planTask({
  agent: researchAgent,
  task: 'Get the current BTC price in USD using the paid market data service and summarize it.',
  serviceCatalog,
})

const researchExecution =
  researchPlan.kind === 'service_call'
    ? await executePaidServiceCall(
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
          agentId: researchAgent.agentId,
          serviceId: researchPlan.serviceId,
          request: researchPlan.request,
        },
      )
    : undefined

const opsSubmitted = await executePaidServiceCall(
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
    agentId: opsAgent.agentId,
    serviceId: 'local.pusd.ops_brief',
    request: {
      symbols: ['BTC', 'ETH', 'SOL'],
      focus: 'ops market pulse',
    },
  },
)

const opsApproved =
  shouldAutoResolveApprovals && opsSubmitted.kind === 'approval_pending'
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
          executionId: opsSubmitted.execution.executionId,
          decision: 'approved',
          approverActorId: 'manager_demo',
          approverRole: 'manager',
          comment: 'Approved during packaged showcase run.',
        },
      )
    : opsSubmitted

const growthBlocked = await executePaidServiceCall(
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
    agentId: growthAgent.agentId,
    serviceId: 'local.pusd.ops_brief',
    request: {
      symbols: ['BTC', 'ETH'],
      focus: 'growth budget check',
    },
  },
)

const currentResearchAgent = await workspace.agentRegistry.get(researchAgent.agentId)
if (currentResearchAgent) {
  const staleAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  await workspace.agentRegistry.put({
    ...currentResearchAgent,
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
    organizationId: 'org_demo',
  },
)

const snapshot = await buildShowcaseSnapshot({
  baseDir,
  zerionClient: ZerionClient.fromEnv(env),
})
const dashboardDir = join(baseDir, 'dashboard')
await mkdir(dashboardDir, { recursive: true })
const dashboardHtmlPath = join(dashboardDir, 'index.html')
await writeFile(dashboardHtmlPath, renderDashboardHtml(snapshot), 'utf8')
const dashboardJsonPath = await writeShowcaseSnapshot({
  baseDir,
  snapshot,
})

const researchAudit = await buildAgentAuditSnapshot({
  baseDir,
  agentId: researchAgent.agentId,
})
const opsAudit = await buildAgentAuditSnapshot({
  baseDir,
  agentId: opsAgent.agentId,
})
const growthAudit = await buildAgentAuditSnapshot({
  baseDir,
  agentId: growthAgent.agentId,
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
        research: researchExecution?.kind,
        opsSubmission: opsSubmitted.kind,
        opsResolution: opsApproved.kind,
        growth: growthBlocked.kind,
        deadMansSwitch,
      },
      agents: {
        research: researchAudit.current,
        ops: opsAudit.current,
        growth: growthAudit.current,
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
