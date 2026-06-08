import express from 'express'
import { join } from 'path'
import {
  buildShowcaseSnapshot,
  createDefaultPalmosServiceCatalog,
  loadAgentSpendWorkspace,
  mergeRegisteredPalmosServices,
  OwsClient,
  PalmosClient,
  readLocalPusdServerConfigFromEnv,
  runDeadMansSwitchSweep,
  startLocalPusdDemoServer,
  XmtpNotifier,
  ZerionClient,
  type ShowcaseSnapshot,
} from '../index.js'
import { FilePusdReadinessReportRegistry } from '../store/PusdReadinessReportRegistry.js'
import { PostgresPusdReadinessReportRegistry } from '../storage/postgres/registries.js'
import type { PalmosServiceCatalog } from '../integrations/pusd/serviceCatalog.js'
import {
  installCors,
  installDashboardAccessGuard,
  registerJudgeAccessRoutes,
} from './dashboard/access.js'
import { installDashboardCsrfProtection } from './dashboard/csrfProtection.js'
import {
  readProcessEnv,
  resolveDashboardBaseDir,
  resolveDashboardPort,
} from './dashboard/config.js'
import type { DashboardRouteContext } from './dashboard/context.js'
import { installDashboardAbuseProtection } from './dashboard/abuseProtection.js'
import { createDashboardOperationalMetricsStore } from './dashboard/operationalMetrics.js'
import { createDashboardOperationalAlertDispatcher } from './dashboard/operationalAlerts.js'
import { createDashboardMutationIdempotencyStore } from './dashboard/mutationIdempotency.js'
import { installDashboardRequestTelemetry } from './dashboard/requestTelemetry.js'
import { registerAgentRoutes } from './dashboard/routes/agentRoutes.js'
import { registerActionRequestRoutes } from './dashboard/routes/actionRequestRoutes.js'
import { registerApprovalReadRoutes } from './dashboard/routes/approvalRoutes.js'
import { registerPublicRoutes } from './dashboard/routes/publicRoutes.js'
import { registerSdkRoutes } from './dashboard/routes/sdkRoutes.js'
import { registerServiceRoutes } from './dashboard/routes/serviceRoutes.js'
import { registerSystemRoutes } from './dashboard/routes/systemRoutes.js'
import { registerTransactionRoutes } from './dashboard/routes/transactionRoutes.js'
import { registerWalletActionRoutes } from './dashboard/routes/walletActionRoutes.js'
import { sanitizeSnapshot } from './dashboard/sanitizers.js'

async function resolveDemoPayToAddress(
  baseDir: string,
  env: Record<string, string | undefined>,
): Promise<string | undefined> {
  const workspace = loadAgentSpendWorkspace({ baseDir, env })
  const agents = await workspace.agentRegistry.list()

  for (const agent of agents) {
    const destination =
      agent.policyConfig?.allowedVendors?.find(
        (vendor) =>
          vendor.vendorId === 'palmos_intel_vendor' ||
          vendor.vendorId === 'palmos_research_vendor' ||
          vendor.vendorId === 'palmos_ops_vendor' ||
          vendor.vendorId === 'local_pusd_demo' ||
          vendor.vendorId === 'ops_research_vendor',
      )?.destinationAddress
    if (destination?.trim()) {
      return destination
    }
  }

  return undefined
}

async function main() {
  const env = readProcessEnv()
  const baseDir = resolveDashboardBaseDir(env)
  const port = resolveDashboardPort(env)
  const workspace = loadAgentSpendWorkspace({ baseDir, env })
  const palmosClient = PalmosClient.fromEnv(env)
  const owsClient = workspace.owsClient ?? OwsClient.fromEnv(baseDir, env)
  const zerionClient = ZerionClient.fromEnv(env)
  const pusdReadinessReports =
    workspace.postgresPool != null
      ? new PostgresPusdReadinessReportRegistry(workspace.postgresPool)
      : new FilePusdReadinessReportRegistry(baseDir)
  const operationalMetrics = createDashboardOperationalMetricsStore()
  const operationalAlerts = createDashboardOperationalAlertDispatcher({ env })
  const mutationIdempotency = createDashboardMutationIdempotencyStore()
  let xmtpNotifier = XmtpNotifier.fromEnv(
    {
      ...env,
      XMTP_DB_PATH: env.XMTP_DB_PATH?.trim() || join(baseDir, 'xmtp-local.db3'),
    },
    workspace.xmtpAlertRegistry,
  )

  try {
    await xmtpNotifier?.assertReady()
  } catch (error) {
    console.warn(
      '[DashboardApi] XMTP notifier disabled:',
      error instanceof Error ? error.message : 'Unable to initialize XMTP.',
    )
    xmtpNotifier = undefined
  }

  let localServer:
    | Awaited<ReturnType<typeof startLocalPusdDemoServer>>
    | undefined
  if (env.START_LOCAL_PUSD_SERVER !== '0') {
    const serverConfig = readLocalPusdServerConfigFromEnv(env)
    const payToAddress = await resolveDemoPayToAddress(baseDir, env)
    localServer = await startLocalPusdDemoServer({
      ...serverConfig,
      payToAddress: payToAddress ?? serverConfig.payToAddress,
    })
    process.env.PUSD_MERCHANT_WALLET = localServer.payToAddress
  }

  const localDemoBaseUrl =
    env.PUSD_DEMO_SERVER_BASE_URL?.trim() ||
    `http://127.0.0.1:${localServer?.port ?? 4021}`

  const defaultServiceCatalog = createDefaultPalmosServiceCatalog({
    localDemoBaseUrl,
    localDemoSpotPriceAmount:
      env.PUSD_DEMO_ONCHAIN_FLOW_PRICE ?? env.PUSD_DEMO_SPOT_PRICE,
    localDemoOpsBriefAmount:
      env.PUSD_DEMO_DEFI_RISK_PRICE ?? env.PUSD_DEMO_OPS_BRIEF_PRICE,
    localDemoVendorBriefAmount: env.PUSD_DEMO_VENDOR_BRIEF_PRICE,
    localDemoLaunchAuditAmount: env.PUSD_DEMO_LAUNCH_AUDIT_PRICE,
  })

  async function buildPalmosServiceCatalog(): Promise<PalmosServiceCatalog> {
    return mergeRegisteredPalmosServices({
      baseCatalog: defaultServiceCatalog,
      services: await workspace.serviceRegistry.list(),
    })
  }

  async function runDashboardDeadMansSwitchSweep(): Promise<void> {
    await runDeadMansSwitchSweep({
      agentRegistry: workspace.agentRegistry,
      walletRegistry: workspace.walletRegistry,
      controlEvents: workspace.controlEventRegistry,
      runs: workspace.runRegistry,
      kernel: workspace.kernel,
      xmtpNotifier,
    }).catch((error) => {
      console.error(
        'Dead-man sweep failed during snapshot refresh:',
        error instanceof Error ? error.message : error,
      )
    })
  }

  async function buildDashboardSnapshot(): Promise<ShowcaseSnapshot> {
    return sanitizeSnapshot(
      await buildShowcaseSnapshot({
        baseDir,
        zerionClient,
        agentRegistry: workspace.agentRegistry,
        walletRegistry: workspace.walletRegistry,
        actionRequestRegistry: workspace.actionRequestRegistry,
        paidCallRegistry: workspace.paidCallRegistry,
        controlEventRegistry: workspace.controlEventRegistry,
        xmtpAlertRegistry: workspace.xmtpAlertRegistry,
        owsAccessRegistry: workspace.owsAccessRegistry,
        pusdReadinessRegistry: pusdReadinessReports,
      }),
    )
  }

  const app = express()
  const context: DashboardRouteContext = {
    env,
    baseDir,
    workspace,
    palmosClient,
    owsClient,
    zerionClient,
    xmtpNotifier,
    pusdReadinessReports,
    operationalMetrics,
    operationalAlerts,
    mutationIdempotency,
    localServer,
    localDemoBaseUrl,
    buildPalmosServiceCatalog,
    buildDashboardSnapshot,
    runDashboardDeadMansSwitchSweep,
  }

  installDashboardRequestTelemetry(app, env, operationalMetrics)
  installDashboardAbuseProtection(app, env)
  installCors(app, env)
  registerPublicRoutes(app, context)
  registerJudgeAccessRoutes(app, context)
  installDashboardAccessGuard(app, env)
  installDashboardCsrfProtection(app, env, operationalMetrics)
  registerSystemRoutes(app, context)
  registerActionRequestRoutes(app, context)
  registerWalletActionRoutes(app, context)
  registerTransactionRoutes(app, context)
  registerApprovalReadRoutes(app, context)
  registerServiceRoutes(app, context)
  registerSdkRoutes(app, context)
  registerAgentRoutes(app, context)

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(
      JSON.stringify(
        {
          ok: true,
          port,
          baseDir,
          localDemoBaseUrl,
          localPusdServer: Boolean(localServer),
          storageDriver: workspace.storageDriver,
        },
        null,
        2,
      ),
    )
  })
  async function shutdown() {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })

    if (localServer) {
      await localServer.close()
    }

    await workspace.postgresPool?.end()
  }

  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0))
  })

  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0))
  })
}

void main().catch((error) => {
  console.error(
    '[DashboardApi] Failed to start:',
    error instanceof Error ? error.stack ?? error.message : error,
  )
  process.exit(1)
})
