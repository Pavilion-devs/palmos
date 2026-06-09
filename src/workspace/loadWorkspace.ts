import {
  DefaultSessionKernel,
  DeterministicSignerGateway,
  FileKernelPersistence,
  OwsWalletProvider,
  FileRunRegistry,
  FileSessionRegistry,
  FileWalletRegistry,
  type RuntimeEnvironment,
  type WalletRegistry,
} from '../../runtime/index.js'
import type { RunRegistry } from '../../runtime/runtime/runRegistry.js'
import type { SessionRegistry } from '../../runtime/runtime/sessionRegistry.js'
import { OwsClient } from '../integrations/ows/client.js'
import {
  createAgentPolicyCandidateResolver,
} from '../policies/compileAgentPolicy.js'
import {
  FileActionRequestRegistry,
  type ActionRequestRegistry,
} from '../store/ActionRequestRegistry.js'
import {
  FileAgentControlEventRegistry,
  type AgentControlEventRegistry,
} from '../store/AgentControlEventRegistry.js'
import {
  FileAgentCredentialRegistry,
  type AgentCredentialRegistry,
} from '../store/AgentCredentialRegistry.js'
import { FileAgentRegistry, type AgentRegistry } from '../store/AgentRegistry.js'
import {
  FileDashboardAuditLogRegistry,
  type DashboardAuditLogRegistry,
} from '../store/DashboardAuditLogRegistry.js'
import {
  FileDashboardOperatorRegistry,
  type DashboardOperatorRegistry,
} from '../store/DashboardOperatorRegistry.js'
import {
  FileDashboardWorkspaceRegistry,
  type DashboardWorkspaceRegistry,
} from '../store/DashboardWorkspaceRegistry.js'
import { FileOwsAccessRegistry, type OwsAccessRegistry } from '../store/OwsAccessRegistry.js'
import {
  FilePalmosServiceRegistry,
  type PalmosServiceRegistry,
} from '../store/PalmosServiceRegistry.js'
import { FilePaidCallRegistry, type PaidCallRegistry } from '../store/PaidCallRegistry.js'
import {
  FilePortfolioSnapshotRegistry,
  type PortfolioSnapshotRegistry,
} from '../store/PortfolioSnapshotRegistry.js'
import { FileXMTPAlertRegistry, type XMTPAlertRegistry } from '../store/XMTPAlertRegistry.js'
import {
  createPostgresPool,
  readPalmosStorageDriver,
  type PostgresPool,
  type PalmosStorageDriver,
} from '../storage/postgres/client.js'
import { PostgresKernelPersistence } from '../storage/postgres/runtimePersistence.js'
import {
  PostgresActionRequestRegistry,
  PostgresAgentControlEventRegistry,
  PostgresAgentCredentialRegistry,
  PostgresAgentRegistry,
  PostgresDashboardAuditLogRegistry,
  PostgresDashboardOperatorRegistry,
  PostgresDashboardWorkspaceRegistry,
  PostgresOwsAccessRegistry,
  PostgresPaidCallRegistry,
  PostgresPalmosServiceRegistry,
  PostgresPortfolioSnapshotRegistry,
  PostgresRunRegistry,
  PostgresSessionRegistry,
  PostgresWalletRegistry,
  PostgresXMTPAlertRegistry,
} from '../storage/postgres/registries.js'

export type AgentSpendWorkspace = {
  baseDir: string
  storageDriver: PalmosStorageDriver
  postgresPool?: PostgresPool
  kernel: DefaultSessionKernel
  agentRegistry: AgentRegistry
  walletRegistry: WalletRegistry
  actionRequestRegistry?: ActionRequestRegistry
  portfolioSnapshotRegistry?: PortfolioSnapshotRegistry
  paidCallRegistry: PaidCallRegistry
  runRegistry: RunRegistry
  controlEventRegistry: AgentControlEventRegistry
  agentCredentialRegistry: AgentCredentialRegistry
  dashboardAuditLogRegistry: DashboardAuditLogRegistry
  dashboardOperatorRegistry: DashboardOperatorRegistry
  dashboardWorkspaceRegistry: DashboardWorkspaceRegistry
  serviceRegistry: PalmosServiceRegistry
  xmtpAlertRegistry: XMTPAlertRegistry
  owsAccessRegistry: OwsAccessRegistry
  owsClient?: OwsClient
}

export function loadAgentSpendWorkspace(input: {
  baseDir: string
  environment?: RuntimeEnvironment
  env?: Record<string, string | undefined>
  now?: () => string
  createId?: (prefix: string) => string
}): AgentSpendWorkspace {
  const now = input.now ?? (() => new Date().toISOString())
  const env = input.env ?? process.env
  const storageDriver = readPalmosStorageDriver(env)
  const postgresPool =
    storageDriver === 'postgres' ? createPostgresPool({ env }) : undefined
  const agentRegistry =
    postgresPool != null
      ? new PostgresAgentRegistry(postgresPool)
      : new FileAgentRegistry(input.baseDir)
  const walletRegistry =
    postgresPool != null
      ? new PostgresWalletRegistry(postgresPool)
      : new FileWalletRegistry(input.baseDir)
  const actionRequestRegistry =
    postgresPool != null
      ? new PostgresActionRequestRegistry(postgresPool)
      : new FileActionRequestRegistry(input.baseDir)
  const portfolioSnapshotRegistry =
    postgresPool != null
      ? new PostgresPortfolioSnapshotRegistry(postgresPool)
      : new FilePortfolioSnapshotRegistry(input.baseDir)
  const paidCallRegistry =
    postgresPool != null
      ? new PostgresPaidCallRegistry(postgresPool, actionRequestRegistry)
      : new FilePaidCallRegistry(input.baseDir, actionRequestRegistry)
  const runRegistry =
    postgresPool != null
      ? new PostgresRunRegistry(postgresPool)
      : new FileRunRegistry(input.baseDir)
  const controlEventRegistry =
    postgresPool != null
      ? new PostgresAgentControlEventRegistry(postgresPool)
      : new FileAgentControlEventRegistry(input.baseDir)
  const agentCredentialRegistry =
    postgresPool != null
      ? new PostgresAgentCredentialRegistry(postgresPool)
      : new FileAgentCredentialRegistry(input.baseDir)
  const dashboardAuditLogRegistry =
    postgresPool != null
      ? new PostgresDashboardAuditLogRegistry(postgresPool)
      : new FileDashboardAuditLogRegistry(input.baseDir)
  const dashboardOperatorRegistry =
    postgresPool != null
      ? new PostgresDashboardOperatorRegistry(postgresPool)
      : new FileDashboardOperatorRegistry(input.baseDir)
  const dashboardWorkspaceRegistry =
    postgresPool != null
      ? new PostgresDashboardWorkspaceRegistry(postgresPool)
      : new FileDashboardWorkspaceRegistry(input.baseDir)
  const serviceRegistry =
    postgresPool != null
      ? new PostgresPalmosServiceRegistry(postgresPool)
      : new FilePalmosServiceRegistry(input.baseDir)
  const xmtpAlertRegistry =
    postgresPool != null
      ? new PostgresXMTPAlertRegistry(postgresPool)
      : new FileXMTPAlertRegistry(input.baseDir)
  const owsAccessRegistry =
    postgresPool != null
      ? new PostgresOwsAccessRegistry(postgresPool)
      : new FileOwsAccessRegistry(input.baseDir)
  const owsClient = OwsClient.fromEnv(input.baseDir)
  const kernel = new DefaultSessionKernel({
    persistence:
      postgresPool != null
        ? new PostgresKernelPersistence(postgresPool)
        : new FileKernelPersistence(input.baseDir),
    sessions:
      postgresPool != null
        ? new PostgresSessionRegistry(postgresPool)
        : new FileSessionRegistry(input.baseDir),
    runs: runRegistry,
    walletRegistry,
    walletProvider:
      owsClient != null
        ? new OwsWalletProvider({
            registry: walletRegistry,
            vaultPath: owsClient.vaultPath,
          })
        : undefined,
    signerGateway: new DeterministicSignerGateway('pending'),
    getPolicyCandidates: createAgentPolicyCandidateResolver({
      agentRegistry,
      now,
    }),
    now,
    createId: input.createId,
  })

  return {
    baseDir: input.baseDir,
    storageDriver,
    postgresPool,
    kernel,
    agentRegistry,
    walletRegistry,
    actionRequestRegistry,
    portfolioSnapshotRegistry,
    paidCallRegistry,
    runRegistry,
    controlEventRegistry,
    agentCredentialRegistry,
    dashboardAuditLogRegistry,
    dashboardOperatorRegistry,
    dashboardWorkspaceRegistry,
    serviceRegistry,
    xmtpAlertRegistry,
    owsAccessRegistry,
    owsClient,
  }
}
