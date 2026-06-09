import type {
  OwsClient,
  PalmosClient,
  PortfolioReader,
  ShowcaseSnapshot,
  XmtpNotifier,
} from '../../index.js'
import type { PalmosServiceCatalog } from '../../integrations/pusd/serviceCatalog.js'
import type { PortfolioSnapshotRegistry } from '../../store/PortfolioSnapshotRegistry.js'
import type { PusdReadinessReportRegistry } from '../../store/PusdReadinessReportRegistry.js'
import type { DashboardOperationalMetricsStore } from './operationalMetrics.js'
import type { DashboardOperationalAlertDispatcher } from './operationalAlerts.js'
import type { DashboardMutationIdempotencyStore } from './mutationIdempotency.js'
import type { AgentSpendWorkspace } from '../../workspace/loadWorkspace.js'
import type { Env } from './shared.js'

export type LocalPusdServerHandle = {
  port: number
  payToAddress: string
  close(): Promise<void>
}

export type DashboardRouteContext = {
  env: Env
  baseDir: string
  workspace: AgentSpendWorkspace
  palmosClient: PalmosClient
  owsClient?: OwsClient
  portfolioReader?: PortfolioReader
  portfolioSnapshotRegistry?: PortfolioSnapshotRegistry
  xmtpNotifier?: XmtpNotifier
  pusdReadinessReports: PusdReadinessReportRegistry
  operationalMetrics: DashboardOperationalMetricsStore
  operationalAlerts: DashboardOperationalAlertDispatcher
  mutationIdempotency?: DashboardMutationIdempotencyStore
  localServer?: LocalPusdServerHandle
  localDemoBaseUrl: string
  buildPalmosServiceCatalog(): Promise<PalmosServiceCatalog>
  buildDashboardSnapshot(): Promise<ShowcaseSnapshot>
  runDashboardDeadMansSwitchSweep(): Promise<void>
}
