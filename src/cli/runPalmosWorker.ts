import { join } from 'path'
import {
  createDefaultPalmosServiceCatalog,
  loadAgentSpendWorkspace,
  OpenAIResearchAgent,
  OwsClient,
  PalmosClient,
  readLocalPusdServerConfigFromEnv,
  runPusdResearchWorker,
  seedDemo,
  startLocalPusdDemoServer,
  XmtpNotifier,
} from '../index.js'

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
  `/tmp/palmos-worker-${Date.now().toString(36)}`
const task = env.AGENT_TASK?.trim()
const agentId = env.PALMOS_WORKER_AGENT_ID?.trim() || 'research_agent'
const shouldStartLocalServer = env.START_LOCAL_PUSD_SERVER !== '0'

let localServer: Awaited<ReturnType<typeof startLocalPusdDemoServer>> | undefined
if (shouldStartLocalServer) {
  const serverConfig = readLocalPusdServerConfigFromEnv(env)
  localServer = await startLocalPusdDemoServer(serverConfig)
  process.env.PUSD_MERCHANT_WALLET = localServer.payToAddress
}

const localDemoBaseUrl = shouldStartLocalServer
  ? `http://127.0.0.1:${localServer?.port ?? 4021}`
  : env.PUSD_DEMO_SERVER_BASE_URL?.trim() || 'http://127.0.0.1:4021'

let workspace = loadAgentSpendWorkspace({
  baseDir,
})

if ((await workspace.agentRegistry.list()).length === 0) {
  await seedDemo({
    baseDir,
    organizationId: env.PALMOS_ORG_ID?.trim() || 'org_demo',
    treasuryId: env.PALMOS_TREASURY_ID?.trim() || 'treasury_demo',
  })
  workspace = loadAgentSpendWorkspace({
    baseDir,
  })
}

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
const result = await runPusdResearchWorker({
  baseDir,
  workspace,
  palmosClient: PalmosClient.fromEnv(env),
  owsClient: workspace.owsClient ?? OwsClient.fromEnv(baseDir, env),
  serviceCatalog,
  xmtpNotifier,
  brain: OpenAIResearchAgent.fromEnv(env),
  agentId,
  task,
})

console.log(
  JSON.stringify(
    {
      ...result,
      localDemoBaseUrl,
      nextStep:
        result.execution.kind === 'approval_pending'
          ? `Pending approval recorded. Review it with: AGENT_SPEND_OS_BASE_DIR=${baseDir} START_LOCAL_PUSD_SERVER=${shouldStartLocalServer ? '1' : '0'} PUSD_DEMO_SERVER_PORT=${localServer?.port ?? 4021} node --import tsx src/cli/reviewPendingApprovals.ts approve ${result.execution.execution.executionId}`
          : undefined,
    },
    null,
    2,
  ),
)

if (localServer) {
  await localServer.close()
}
