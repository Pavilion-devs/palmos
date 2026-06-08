import { join } from 'path'
import {
  createDefaultPalmosServiceCatalog,
  loadProcessEnv,
  loadAgentSpendWorkspace,
  OpenAIResearchAgent,
  OwsClient,
  PalmosClient,
  readLocalPusdServerConfigFromEnv,
  runPusdResearchWorker,
  startLocalPusdDemoServer,
  XmtpNotifier,
} from '../index.js'

const env = loadProcessEnv()
const baseDir =
  env.AGENT_SPEND_OS_BASE_DIR?.trim() ||
  `/tmp/palmos-worker-${Date.now().toString(36)}`
const task = env.AGENT_TASK?.trim()
const agentId = env.PALMOS_WORKER_AGENT_ID?.trim()
const shouldStartLocalServer = env.START_LOCAL_PUSD_SERVER !== '0'

if (!agentId) {
  throw new Error(
    'Set PALMOS_WORKER_AGENT_ID to a persisted PalmOS agent. Create one first with npm run palmos:init.',
  )
}

let localServer: Awaited<ReturnType<typeof startLocalPusdDemoServer>> | undefined
if (shouldStartLocalServer) {
  const serverConfig = readLocalPusdServerConfigFromEnv(env)
  localServer = await startLocalPusdDemoServer(serverConfig)
  process.env.PUSD_MERCHANT_WALLET = localServer.payToAddress
}

const localDemoBaseUrl = shouldStartLocalServer
  ? `http://127.0.0.1:${localServer?.port ?? 4021}`
  : env.PUSD_DEMO_SERVER_BASE_URL?.trim() || 'http://127.0.0.1:4021'

const workspace = loadAgentSpendWorkspace({
  baseDir,
})

const agent = await workspace.agentRegistry.get(agentId)
if (!agent) {
  throw new Error(
    `Agent ${agentId} was not found in ${baseDir}. Create or import the agent before running the worker.`,
  )
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
  env,
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
