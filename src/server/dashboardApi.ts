import express from 'express'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  authenticateAgentCredential,
  buildShowcaseSnapshot,
  checkPusdPaymentReadiness,
  createDefaultPalmosServiceCatalog,
  createAgentCredential,
  createAgentFromOnboarding,
  executePaidServiceCall,
  loadAgentSpendWorkspace,
  mergeRegisteredPalmosServices,
  OpenAIResearchAgent,
  OwsClient,
  PalmosClient,
  readPusdMintFromEnv,
  readLocalPusdServerConfigFromEnv,
  readSolanaRpcUrlFromEnv,
  resolvePendingPaidCallApproval,
  runDashboardScenario,
  runDeadMansSwitchSweep,
  runPusdResearchWorker,
  SOLANA_MAINNET_CHAIN_ID,
  startLocalPusdDemoServer,
  XmtpNotifier,
  ZerionClient,
  type RegisteredPalmosServiceRecord,
  type PusdResearchWorkerResult,
  type ShowcaseSnapshot,
} from '../index.js'
import {
  PALMOS_LOCAL_DEMO_MERCHANT_WALLET,
} from '../integrations/pusd/constants.js'
import type { PalmosServiceCatalog } from '../integrations/pusd/serviceCatalog.js'
import {
  createOnboardingTurn,
  readOnboardingField,
  readOnboardingState,
} from './onboardingEngine.js'

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      cwd?: () => string
      env?: Record<string, string | undefined>
    }
  }

  const processEnv = scope.process?.env ?? {}
  const cwd = scope.process?.cwd?.() ?? '.'
  const envPath = join(cwd, '.env')
  if (!existsSync(envPath)) {
    return processEnv
  }

  const fileEnv: Record<string, string> = {}
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
    fileEnv[key] = value
  }

  return {
    ...fileEnv,
    ...processEnv,
  }
}

function resolveDashboardBaseDir(
  env: Record<string, string | undefined>,
): string {
  const configuredBaseDir = env.AGENT_SPEND_OS_BASE_DIR?.trim()
  if (configuredBaseDir) {
    return configuredBaseDir
  }

  if (env.RENDER?.trim()) {
    return '/opt/render/project/src/storage/palmos-live'
  }

  return '/tmp/palmos-live'
}

function resolveDashboardPort(env: Record<string, string | undefined>): number {
  const configuredPort = env.PORT?.trim() || env.DASHBOARD_API_PORT?.trim() || '4030'
  const parsed = Number(configuredPort)
  return Number.isFinite(parsed) ? parsed : 4030
}

function stripAgentSecrets<T extends { owsVaultPath?: string }>(agent: T): Omit<T, 'owsVaultPath'> {
  const { owsVaultPath: _owsVaultPath, ...safeAgent } = agent
  return safeAgent
}

function sanitizeSnapshot(snapshot: ShowcaseSnapshot): ShowcaseSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map((agentSnapshot) => ({
      ...agentSnapshot,
      agent: stripAgentSecrets(agentSnapshot.agent),
      owsAccess: agentSnapshot.owsAccess
        ? {
            agentId: agentSnapshot.owsAccess.agentId,
            createdAt: agentSnapshot.owsAccess.createdAt,
            updatedAt: agentSnapshot.owsAccess.updatedAt,
            runtimeWalletId: agentSnapshot.owsAccess.runtimeWalletId,
            owsWalletId: agentSnapshot.owsAccess.owsWalletId,
            owsWalletName: agentSnapshot.owsAccess.owsWalletName,
            vaultPath: agentSnapshot.owsAccess.vaultPath,
            apiKeyId: agentSnapshot.owsAccess.apiKeyId,
            apiKeyName: agentSnapshot.owsAccess.apiKeyName,
          }
        : undefined,
      audit: {
        ...agentSnapshot.audit,
        agent: stripAgentSecrets(agentSnapshot.audit.agent),
      },
    })),
  }
}

function sanitizeWorkerResult(result: PusdResearchWorkerResult) {
  return {
    ...result,
    agent: stripAgentSecrets(result.agent),
    execution: {
      ...result.execution,
      agent: stripAgentSecrets(result.execution.agent),
    },
  }
}

function readMaybeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

type DashboardOnboardingSetup = {
  agentName?: string
  agentTask?: string
  maxPerCall?: string
  sessionBudget?: string
  autoApproveUnder?: string
  allowedVendors?: string[]
  walletMode?: string
  managerAddress?: string
}

function readAuthToken(req: express.Request): string | undefined {
  const authorization = req.headers.authorization
  const authorizationValue = Array.isArray(authorization)
    ? authorization[0]
    : authorization
  if (authorizationValue?.startsWith('Bearer ')) {
    return authorizationValue.slice('Bearer '.length).trim()
  }

  const agentKey = req.headers['x-palmos-agent-key']
  const agentKeyValue = Array.isArray(agentKey) ? agentKey[0] : agentKey
  return readMaybeString(agentKeyValue)
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function sanitizeCredential(record: {
  credentialId: string
  agentId: string
  label: string
  keyPrefix: string
  status: string
  createdAt?: string
  updatedAt?: string
  lastUsedAt?: string
}) {
  return {
    credentialId: record.credentialId,
    agentId: record.agentId,
    label: record.label,
    keyPrefix: record.keyPrefix,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt,
  }
}

function sanitizeService(record: RegisteredPalmosServiceRecord) {
  return {
    serviceId: record.serviceId,
    label: record.label,
    vendorId: record.vendorId,
    destinationAddress: record.destinationAddress,
    endpointUrl: record.endpointUrl,
    method: record.method,
    requestMode: record.requestMode,
    expectedAmount: record.expectedAmount,
    chainId: record.chainId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function normalizeServiceId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 96)
}

function normalizeVendorId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96)
}

function readServiceMethod(value: unknown): 'GET' | 'POST' {
  return readMaybeString(value)?.toUpperCase() === 'POST' ? 'POST' : 'GET'
}

function readServiceRequestMode(value: unknown, method: 'GET' | 'POST'): 'query' | 'json' {
  const mode = readMaybeString(value)?.toLowerCase()
  if (mode === 'json') {
    return 'json'
  }
  if (mode === 'query') {
    return 'query'
  }

  return method === 'POST' ? 'json' : 'query'
}

function readPositiveAmount(value: unknown, fallback: string): string {
  const raw = readMaybeString(value)
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed.toFixed(6).replace(/\.?0+$/, '')
}

function readRegisteredServiceInput(value: unknown): Omit<
  RegisteredPalmosServiceRecord,
  'createdAt' | 'updatedAt' | 'status'
> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  const serviceId = normalizeServiceId(readMaybeString(candidate.serviceId) ?? '')
  const endpointUrl = readMaybeString(candidate.endpointUrl)
  const destinationAddress = readMaybeString(candidate.destinationAddress)
  const label = readMaybeString(candidate.label) ?? serviceId
  const method = readServiceMethod(candidate.method)
  const vendorId =
    normalizeVendorId(readMaybeString(candidate.vendorId) ?? serviceId) ||
    normalizeVendorId(serviceId)

  if (!serviceId || !endpointUrl || !destinationAddress || !vendorId) {
    return undefined
  }

  try {
    const parsedUrl = new URL(endpointUrl)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return undefined
    }
  } catch {
    return undefined
  }

  return {
    serviceId,
    label,
    vendorId,
    destinationAddress,
    endpointUrl,
    method,
    requestMode: readServiceRequestMode(candidate.requestMode, method),
    expectedAmount: readPositiveAmount(candidate.expectedAmount, '0.01'),
    chainId: SOLANA_MAINNET_CHAIN_ID,
  }
}

function readOnboardingSetup(value: unknown): DashboardOnboardingSetup | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  return {
    agentName: readMaybeString(candidate.agentName),
    agentTask: readMaybeString(candidate.agentTask),
    maxPerCall: readMaybeString(candidate.maxPerCall),
    sessionBudget: readMaybeString(candidate.sessionBudget),
    autoApproveUnder: readMaybeString(candidate.autoApproveUnder),
    allowedVendors: Array.isArray(candidate.allowedVendors)
      ? candidate.allowedVendors
          .map((vendor) => readMaybeString(vendor))
          .filter((vendor): vendor is string => Boolean(vendor))
      : undefined,
    walletMode: readMaybeString(candidate.walletMode),
    managerAddress: readMaybeString(candidate.managerAddress),
  }
}

async function authenticateSdkRequest(input: {
  req: express.Request
  workspace: ReturnType<typeof loadAgentSpendWorkspace>
}) {
  const token = readAuthToken(input.req)
  if (!token) {
    return undefined
  }

  return authenticateAgentCredential(
    {
      credentials: input.workspace.agentCredentialRegistry,
      agentRegistry: input.workspace.agentRegistry,
    },
    token,
  )
}

async function resolveDemoPayToAddress(baseDir: string): Promise<string | undefined> {
  const workspace = loadAgentSpendWorkspace({ baseDir })
  const agents = await workspace.agentRegistry.list()

  for (const agent of agents) {
    const destination =
      agent.policyConfig?.allowedVendors?.find(
        (vendor) =>
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
  const workspace = loadAgentSpendWorkspace({ baseDir })
  const palmosClient = PalmosClient.fromEnv(env)
  const owsClient = workspace.owsClient ?? OwsClient.fromEnv(baseDir, env)
  const zerionClient = ZerionClient.fromEnv(env)
  const xmtpNotifier = XmtpNotifier.fromEnv(
    {
      ...env,
      XMTP_DB_PATH: env.XMTP_DB_PATH?.trim() || join(baseDir, 'xmtp-local.db3'),
    },
    workspace.xmtpAlertRegistry,
  )

  await xmtpNotifier?.assertReady()

  let localServer: Awaited<ReturnType<typeof startLocalPusdDemoServer>> | undefined
  if (env.START_LOCAL_PUSD_SERVER !== '0') {
    const serverConfig = readLocalPusdServerConfigFromEnv(env)
    const payToAddress = await resolveDemoPayToAddress(baseDir)
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
    localDemoSpotPriceAmount: env.PUSD_DEMO_SPOT_PRICE,
    localDemoOpsBriefAmount: env.PUSD_DEMO_OPS_BRIEF_PRICE,
  })

  async function buildPalmosServiceCatalog(): Promise<PalmosServiceCatalog> {
    return mergeRegisteredPalmosServices({
      baseCatalog: defaultServiceCatalog,
      services: await workspace.serviceRegistry.list(),
    })
  }

  async function buildDashboardSnapshot(): Promise<ShowcaseSnapshot> {
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

    return sanitizeSnapshot(
      await buildShowcaseSnapshot({
        baseDir,
        zerionClient,
      }),
    )
  }

  const app = express()
  app.use(express.json())
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-PalmOS-Agent-Key',
    )
    if (_req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })

  app.get('/api/dashboard/health', async (_req, res) => {
    const snapshot = await buildDashboardSnapshot()
    res.json({
      ok: true,
      baseDir,
      agentCount: snapshot.summary.agentCount,
      pendingCalls: snapshot.summary.approvalPendingCalls,
      localDemoBaseUrl,
      localPusdServer: Boolean(localServer),
    })
  })

  app.get('/api/dashboard/snapshot', async (_req, res) => {
    const snapshot = await buildDashboardSnapshot()
    res.json(snapshot)
  })

  app.get('/api/dashboard/worker/status', async (_req, res) => {
    const snapshot = await buildDashboardSnapshot()
    const recentPaidCalls = snapshot.agents
      .flatMap((agent) => agent.paidCalls)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 10)

    res.json({
      ok: true,
      baseDir,
      recentPaidCalls,
      summary: snapshot.summary,
    })
  })

  app.get('/api/dashboard/services', async (_req, res) => {
    const catalog = await buildPalmosServiceCatalog()
    const registeredServices = await workspace.serviceRegistry.list()
    const registeredById = new Map(
      registeredServices.map((service) => [service.serviceId, service]),
    )

    res.json({
      ok: true,
      services: Object.values(catalog).map((service) => {
        const registered = registeredById.get(service.serviceId)
        return {
          serviceId: service.serviceId,
          label: service.label,
          vendorId: service.vendorId,
          chainId: service.chainId,
          assetSymbol: service.assetSymbol,
          expectedAmount: service.expectedAmount,
          paymentRail: service.paymentRail,
          source: registered ? 'registered' : 'built_in',
          registered: registered ? sanitizeService(registered) : undefined,
        }
      }),
    })
  })

  app.post('/api/dashboard/services', async (req, res) => {
    try {
      const input = readRegisteredServiceInput(req.body)
      if (!input) {
        res.status(400).json({
          ok: false,
          error:
            'Missing service fields. Provide serviceId, endpointUrl, destinationAddress, and expectedAmount.',
        })
        return
      }

      const existing = await workspace.serviceRegistry.get(input.serviceId)
      const at = new Date().toISOString()
      const record: RegisteredPalmosServiceRecord = {
        ...input,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
        status: existing?.status ?? 'active',
      }
      await workspace.serviceRegistry.put(record)

      res.json({
        ok: true,
        service: sanitizeService(record),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to register PalmOS service.',
      })
    }
  })

  app.post('/api/dashboard/agents/:agentId/services/:serviceId/allow', async (req, res) => {
    try {
      const agentId = readMaybeString(req.params.agentId)
      const serviceId = readMaybeString(req.params.serviceId)
      if (!agentId || !serviceId) {
        res.status(400).json({
          ok: false,
          error: 'Missing agent id or service id.',
        })
        return
      }

      const agent = await workspace.agentRegistry.get(agentId)
      if (!agent) {
        res.status(404).json({
          ok: false,
          error: `Agent ${agentId} was not found.`,
        })
        return
      }

      const catalog = await buildPalmosServiceCatalog()
      const service = catalog[serviceId]
      if (!service) {
        res.status(404).json({
          ok: false,
          error: `Service ${serviceId} was not found.`,
        })
        return
      }

      const registeredService = await workspace.serviceRegistry.get(serviceId)
      const destinationAddress =
        registeredService?.destinationAddress ??
        localServer?.payToAddress ??
        env.PUSD_MERCHANT_WALLET?.trim() ??
        PALMOS_LOCAL_DEMO_MERCHANT_WALLET
      const vendorRule = {
        vendorId: service.vendorId,
        label: service.label,
        destinationAddress,
        chainId: service.chainId,
      }
      const nextAllowedVendors = [
        ...agent.policyConfig.allowedVendors.filter(
          (vendor) => vendor.vendorId !== vendorRule.vendorId,
        ),
        vendorRule,
      ]
      const updatedAgent = {
        ...agent,
        updatedAt: new Date().toISOString(),
        policyConfig: {
          ...agent.policyConfig,
          allowedVendors: nextAllowedVendors,
        },
      }
      await workspace.agentRegistry.put(updatedAgent)

      res.json({
        ok: true,
        agent: stripAgentSecrets(updatedAgent),
        service: {
          serviceId: service.serviceId,
          label: service.label,
          vendorId: service.vendorId,
          chainId: service.chainId,
          assetSymbol: service.assetSymbol,
          expectedAmount: service.expectedAmount,
          paymentRail: service.paymentRail,
        },
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to allow service for agent.',
      })
    }
  })

  app.get('/api/sdk/v1/me', async (req, res) => {
    const auth = await authenticateSdkRequest({ req, workspace })
    if (!auth) {
      res.status(401).json({
        ok: false,
        error: 'Missing or invalid PalmOS agent credential.',
      })
      return
    }

    res.json({
      ok: true,
      agent: stripAgentSecrets(auth.agent),
      credential: sanitizeCredential(auth.credential),
    })
  })

  app.get('/api/sdk/v1/services', async (req, res) => {
    const auth = await authenticateSdkRequest({ req, workspace })
    if (!auth) {
      res.status(401).json({
        ok: false,
        error: 'Missing or invalid PalmOS agent credential.',
      })
      return
    }

    const allowedVendorIds = new Set(
      auth.agent.policyConfig.allowedVendors.map((vendor) => vendor.vendorId),
    )
    const serviceCatalog = await buildPalmosServiceCatalog()
    res.json({
      ok: true,
      agentId: auth.agent.agentId,
      services: Object.values(serviceCatalog).map((service) => ({
        serviceId: service.serviceId,
        label: service.label,
        vendorId: service.vendorId,
        chainId: service.chainId,
        assetSymbol: service.assetSymbol,
        expectedAmount: service.expectedAmount,
        paymentRail: service.paymentRail,
        allowed: allowedVendorIds.has(service.vendorId),
      })),
    })
  })

  app.post('/api/sdk/v1/pay', async (req, res) => {
    try {
      const auth = await authenticateSdkRequest({ req, workspace })
      if (!auth) {
        res.status(401).json({
          ok: false,
          error: 'Missing or invalid PalmOS agent credential.',
        })
        return
      }

      const serviceId = readMaybeString(req.body?.serviceId)
      if (!serviceId) {
        res.status(400).json({
          ok: false,
          error: 'Missing serviceId.',
        })
        return
      }

      const serviceCatalog = await buildPalmosServiceCatalog()
      if (!serviceCatalog[serviceId]) {
        res.status(404).json({
          ok: false,
          error: `Unknown PalmOS service: ${serviceId}`,
        })
        return
      }

      const result = await executePaidServiceCall(
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
          agentId: auth.agent.agentId,
          serviceId,
          request: readRecord(req.body?.request),
          amount: readMaybeString(req.body?.amount),
          note: readMaybeString(req.body?.note),
        },
      )

      res.json({
        ok: true,
        agentId: auth.agent.agentId,
        credentialId: auth.credential.credentialId,
        result: {
          ...result,
          agent: stripAgentSecrets(result.agent),
        },
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to execute PalmOS SDK payment request.',
      })
    }
  })

  app.post('/api/dashboard/onboarding/turn', async (req, res) => {
    try {
      const turn = await createOnboardingTurn(env, {
        field: readMaybeString(req.body?.field),
        userReply: readMaybeString(req.body?.userReply) ?? '',
        state: req.body?.state,
      })

      res.json(turn)
    } catch (error) {
      res.status(500).json({
        ok: false,
        complete: false,
        state: readOnboardingState(req.body?.state),
        field: readOnboardingField(req.body?.field),
        inputType: 'text',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to continue PalmOS onboarding.',
      })
    }
  })

  app.get('/api/dashboard/agents', async (_req, res) => {
    const snapshot = await buildDashboardSnapshot()
    res.json({
      ok: true,
      agents: snapshot.agents,
      summary: snapshot.summary,
    })
  })

  app.post('/api/dashboard/agents', async (req, res) => {
    try {
      const setup = readOnboardingSetup(req.body?.setup ?? req.body)
      if (!setup) {
        res.status(400).json({
          ok: false,
          error: 'Missing agent setup payload.',
        })
        return
      }

      const created = await createAgentFromOnboarding(
        {
          workspace,
          credentials: workspace.agentCredentialRegistry,
          serviceCatalog: await buildPalmosServiceCatalog(),
        },
        {
          ...setup,
          organizationId: env.PALMOS_ORG_ID?.trim() || 'org_demo',
          treasuryId: env.PALMOS_TREASURY_ID?.trim() || 'treasury_demo',
          servicePayToAddress:
            localServer?.payToAddress ??
            env.PUSD_MERCHANT_WALLET?.trim() ??
            PALMOS_LOCAL_DEMO_MERCHANT_WALLET,
        },
      )
      const snapshot = await buildDashboardSnapshot()

      res.json({
        ok: true,
        agent: stripAgentSecrets(created.agent),
        credential: sanitizeCredential(created.credential),
        token: created.token,
        snapshot,
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to create PalmOS agent.',
      })
    }
  })

  app.get('/api/dashboard/agents/:agentId/credentials', async (req, res) => {
    try {
      const agentId = readMaybeString(req.params.agentId)
      if (!agentId) {
        res.status(400).json({
          ok: false,
          error: 'Missing agent id.',
        })
        return
      }

      const agent = await workspace.agentRegistry.get(agentId)
      if (!agent) {
        res.status(404).json({
          ok: false,
          error: `Agent ${agentId} was not found.`,
        })
        return
      }

      const credentials =
        await workspace.agentCredentialRegistry.listByAgent(agentId)
      res.json({
        ok: true,
        agent: stripAgentSecrets(agent),
        credentials: credentials.map(sanitizeCredential),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to list agent credentials.',
      })
    }
  })

  app.post('/api/dashboard/agents/:agentId/credentials', async (req, res) => {
    try {
      const agentId = readMaybeString(req.params.agentId)
      if (!agentId) {
        res.status(400).json({
          ok: false,
          error: 'Missing agent id.',
        })
        return
      }

      const agent = await workspace.agentRegistry.get(agentId)
      if (!agent) {
        res.status(404).json({
          ok: false,
          error: `Agent ${agentId} was not found.`,
        })
        return
      }

      const created = await createAgentCredential(
        {
          credentials: workspace.agentCredentialRegistry,
        },
        {
          agentId,
          label: readMaybeString(req.body?.label) ?? 'SDK key',
        },
      )

      res.json({
        ok: true,
        agent: stripAgentSecrets(agent),
        credential: sanitizeCredential(created.credential),
        token: created.token,
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to create agent credential.',
      })
    }
  })

  app.post('/api/dashboard/agent-credentials/:credentialId/revoke', async (req, res) => {
    try {
      const credentialId = readMaybeString(req.params.credentialId)
      if (!credentialId) {
        res.status(400).json({
          ok: false,
          error: 'Missing credential id.',
        })
        return
      }

      const credential = await workspace.agentCredentialRegistry.get(credentialId)
      if (!credential) {
        res.status(404).json({
          ok: false,
          error: `Credential ${credentialId} was not found.`,
        })
        return
      }

      const at = new Date().toISOString()
      const revoked = {
        ...credential,
        status: 'revoked' as const,
        updatedAt: at,
      }
      await workspace.agentCredentialRegistry.put(revoked)

      res.json({
        ok: true,
        credential: sanitizeCredential(revoked),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to revoke agent credential.',
      })
    }
  })

  app.post('/api/dashboard/agents/:agentId/run', async (req, res) => {
    try {
      const agentId = readMaybeString(req.params.agentId)
      if (!agentId) {
        res.status(400).json({
          ok: false,
          error: 'Missing agent id.',
        })
        return
      }

      const agent = await workspace.agentRegistry.get(agentId)
      if (!agent) {
        res.status(404).json({
          ok: false,
          error: `Agent ${agentId} was not found.`,
        })
        return
      }

      const result = await runPusdResearchWorker({
        baseDir,
        workspace,
        palmosClient,
        owsClient,
        xmtpNotifier,
        serviceCatalog: await buildPalmosServiceCatalog(),
        brain: OpenAIResearchAgent.fromEnv(env),
        agentId,
        task: readMaybeString(req.body?.task),
      })
      const snapshot = await buildDashboardSnapshot()

      res.json({
        ok: true,
        result: sanitizeWorkerResult(result),
        snapshot,
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to run the PalmOS agent.',
      })
    }
  })

  app.post('/api/dashboard/worker/run', async (req, res) => {
    try {
      const agentId = readMaybeString(req.body?.agentId)
      if (!agentId) {
        res.status(400).json({
          ok: false,
          error: 'Select or create an agent before running PalmOS.',
        })
        return
      }

      const result = await runPusdResearchWorker({
        baseDir,
        workspace,
        palmosClient,
        owsClient,
        xmtpNotifier,
        serviceCatalog: await buildPalmosServiceCatalog(),
        brain: OpenAIResearchAgent.fromEnv(env),
        agentId,
        task: readMaybeString(req.body?.task),
      })
      const snapshot = await buildDashboardSnapshot()

      res.json({
        ok: true,
        result: sanitizeWorkerResult(result),
        snapshot,
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to run the PalmOS worker.',
      })
    }
  })

  app.get('/api/dashboard/pusd/readiness', async (req, res) => {
    try {
      const agents = await workspace.agentRegistry.list()
      const agentId = readMaybeString(req.query.agentId) ?? agents[0]?.agentId
      const walletName = readMaybeString(req.query.wallet)
      const explicitPayer = readMaybeString(req.query.payer)
      const agent = agentId ? await workspace.agentRegistry.get(agentId) : undefined
      const resolvedWalletName =
        walletName ?? agent?.owsWalletName ?? env.PALMOS_READINESS_OWS_WALLET
      const payer =
        explicitPayer ??
        (resolvedWalletName && owsClient?.getSolanaAddress(resolvedWalletName)) ??
        undefined
      const recipient =
        readMaybeString(req.query.recipient) ??
        env.PUSD_MERCHANT_WALLET?.trim() ??
        localServer?.payToAddress
      const amount =
        readMaybeString(req.query.amount) ??
        env.PUSD_READINESS_AMOUNT?.trim() ??
        '0.01'
      const mint =
        readMaybeString(req.query.mint) ?? readPusdMintFromEnv(env)
      const rpcUrl =
        readMaybeString(req.query.rpcUrl) ?? readSolanaRpcUrlFromEnv(env)

      if (!payer) {
        res.json({
          ok: false,
          error:
            'Missing payer. Provide ?payer=..., ?wallet=..., or seed an OWS-backed agent.',
          agentId,
          walletName: resolvedWalletName,
        })
        return
      }

      if (!recipient) {
        res.json({
          ok: false,
          error: 'Missing recipient. Provide ?recipient=... or set PUSD_MERCHANT_WALLET.',
          agentId,
          walletName: resolvedWalletName,
        })
        return
      }

      const report = await checkPusdPaymentReadiness({
        payer,
        recipient,
        amount,
        mint,
        rpcUrl,
        env,
      })

      res.json({
        ok: report.ok,
        agentId,
        walletName: resolvedWalletName,
        report,
      })
    } catch (error) {
      res.json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to complete PUSD readiness check.',
      })
    }
  })

  app.post('/api/dashboard/showcase/run', async (_req, res) => {
    try {
      const result = await runDashboardScenario({
        baseDir,
        env,
        workspace,
        palmosClient,
        owsClient,
        xmtpNotifier,
        zerionClient,
        serviceCatalog: await buildPalmosServiceCatalog(),
      })

      res.json({
        ok: true,
        outcomes: result.outcomes,
        snapshot: sanitizeSnapshot(result.snapshot),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to run the live dashboard scenario.',
      })
    }
  })

  app.post('/api/dashboard/approvals/:executionId/:decision', async (req, res) => {
    const executionId = req.params.executionId
    const decision = req.params.decision

    if (decision !== 'approve' && decision !== 'reject') {
      res.status(400).json({
        ok: false,
        error: 'Unsupported decision. Use approve or reject.',
      })
      return
    }

    try {
      const result = await resolvePendingPaidCallApproval(
        {
          kernel: workspace.kernel,
          agentRegistry: workspace.agentRegistry,
          paidCalls: workspace.paidCallRegistry,
          palmosClient,
          owsClient,
          serviceCatalog: await buildPalmosServiceCatalog(),
          xmtpNotifier,
        },
        {
          executionId,
          decision: decision === 'approve' ? 'approved' : 'rejected',
          approverActorId:
            req.body?.approverActorId || env.DASHBOARD_APPROVER_ACTOR_ID || 'manager_dashboard',
          approverRole:
            req.body?.approverRole || env.DASHBOARD_APPROVER_ROLE || 'manager',
          comment:
            req.body?.comment ||
            (decision === 'approve'
              ? 'Approved from dashboard UI.'
              : 'Rejected from dashboard UI.'),
        },
      )

      const snapshot = await buildDashboardSnapshot()

      res.json({
        ok: true,
        result,
        snapshot,
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Approval request failed.',
      })
    }
  })

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(
      JSON.stringify(
        {
          ok: true,
          port,
          baseDir,
          localDemoBaseUrl,
          localPusdServer: Boolean(localServer),
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
