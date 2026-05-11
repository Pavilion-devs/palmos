import express from 'express'
import { createHmac, timingSafeEqual } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { isIP } from 'net'
import { join } from 'path'
import { PublicKey } from '@solana/web3.js'
import {
  authenticateAgentCredential,
  buildShowcaseSnapshot,
  checkPusdPaymentReadiness,
  createDefaultPalmosServiceCatalog,
  createAgentCredential,
  createAgentFromOnboarding,
  executePaidServiceCall,
  loadProcessEnv,
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
import { FilePusdReadinessReportRegistry } from '../store/PusdReadinessReportRegistry.js'
import type { PalmosServiceCatalog } from '../integrations/pusd/serviceCatalog.js'
import {
  createOnboardingTurn,
  readOnboardingField,
  readOnboardingState,
} from './onboardingEngine.js'

function readProcessEnv(): Record<string, string | undefined> {
  return loadProcessEnv()
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

type WaitlistSubmission = {
  id: string
  createdAt: string
  name: string
  email: string
  roleCompany: string
  agentUseCase: string
  source: 'landing'
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

function isPublicAccessMode(env: Record<string, string | undefined>): boolean {
  return (
    env.PALMOS_PUBLIC_ACCESS_MODE?.trim() === '1' ||
    env.PALMOS_PUBLIC_ACCESS_MODE?.trim()?.toLowerCase() === 'true' ||
    Boolean(env.RENDER?.trim())
  )
}

function isShowcaseRunEnabled(env: Record<string, string | undefined>): boolean {
  return (
    env.PALMOS_ENABLE_SHOWCASE_RUN?.trim() === '1' ||
    env.PALMOS_ENABLE_SHOWCASE_RUN?.trim()?.toLowerCase() === 'true'
  )
}

function normalizeOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === '*') {
    return undefined
  }

  try {
    return new URL(trimmed).origin
  } catch {
    return undefined
  }
}

function readCsvValues(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildAllowedCorsOrigins(
  env: Record<string, string | undefined>,
): Set<string> {
  const configuredOrigins = [
    ...readCsvValues(env.PALMOS_ALLOWED_ORIGINS),
    ...readCsvValues(env.DASHBOARD_ALLOWED_ORIGINS),
    env.PALMOS_FRONTEND_ORIGIN,
    env.FRONTEND_ORIGIN,
  ]
  const localOrigins = [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:4173',
    'http://localhost:4173',
    'http://127.0.0.1:4030',
    'http://localhost:4030',
  ]
  const origins = [...configuredOrigins, ...localOrigins]
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin))

  return new Set(origins)
}

function readCookie(req: express.Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie
  const rawCookie = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader
  if (!rawCookie) return undefined

  for (const segment of rawCookie.split(';')) {
    const [key, ...valueParts] = segment.trim().split('=')
    if (key === name) {
      return decodeURIComponent(valueParts.join('='))
    }
  }

  return undefined
}

function signJudgeAccessExpiry(expiresAt: number, secret: string): string {
  const payload = String(expiresAt)
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url')

  return `${payload}.${signature}`
}

function verifyJudgeAccessExpiry(
  cookieValue: string | undefined,
  secret: string | undefined,
): number {
  if (!cookieValue || !secret) {
    return 0
  }

  const [payload, signature] = cookieValue.split('.')
  const expiresAt = Number(payload)
  if (!payload || !signature || !Number.isFinite(expiresAt)) {
    return 0
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url')
  const supplied = Buffer.from(signature)
  const expected = Buffer.from(expectedSignature)

  if (supplied.length !== expected.length) {
    return 0
  }

  return timingSafeEqual(supplied, expected) ? expiresAt : 0
}

function readJudgeAccessExpiry(
  req: express.Request,
  env: Record<string, string | undefined>,
): number {
  const sessionValue = readCookie(req, 'palmos_judge_access')
  return verifyJudgeAccessExpiry(
    sessionValue,
    env.PALMOS_JUDGE_ACCESS_CODE?.trim(),
  )
}

function shouldUseCrossSiteJudgeCookie(env: Record<string, string | undefined>): boolean {
  return (
    env.PALMOS_CROSS_SITE_COOKIES?.trim() === '1' ||
    env.PALMOS_CROSS_SITE_COOKIES?.trim()?.toLowerCase() === 'true' ||
    Boolean(env.RENDER?.trim())
  )
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function sanitizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function readWaitlistSubmission(value: unknown): Omit<WaitlistSubmission, 'id' | 'createdAt' | 'source'> | undefined {
  const candidate = readRecord(value)
  const name = readMaybeString(candidate.name)
  const email = readMaybeString(candidate.email)
  const roleCompany = readMaybeString(candidate.roleCompany)
  const agentUseCase = readMaybeString(candidate.agentUseCase)

  if (!name || !email || !roleCompany || !agentUseCase) {
    return undefined
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return undefined
  }

  return {
    name: name.slice(0, 160),
    email: sanitizeEmail(email).slice(0, 240),
    roleCompany: roleCompany.slice(0, 200),
    agentUseCase: agentUseCase.slice(0, 800),
  }
}

async function readWaitlist(baseDir: string): Promise<WaitlistSubmission[]> {
  try {
    const contents = await readFile(join(baseDir, 'waitlist-submissions.json'), 'utf8')
    const parsed = JSON.parse(contents)
    return Array.isArray(parsed) ? parsed as WaitlistSubmission[] : []
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return []
    }

    throw error
  }
}

async function appendWaitlistSubmission(baseDir: string, submission: WaitlistSubmission): Promise<void> {
  await mkdir(baseDir, { recursive: true })
  const current = await readWaitlist(baseDir)
  const deduped = current.filter((item) => item.email !== submission.email)
  await writeFile(
    join(baseDir, 'waitlist-submissions.json'),
    JSON.stringify([...deduped, submission], null, 2),
    'utf8',
  )
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

function readOptionalPositiveAmount(value: unknown): string | undefined {
  const raw = readMaybeString(value)
  if (!raw) return undefined

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }

  return parsed.toFixed(6).replace(/\.?0+$/, '')
}

function readAgentPolicyPatch(value: unknown): {
  sessionBudget?: string
  maxPerTransaction?: string
  autoApproveUnder?: string
  heartbeatTimeoutSeconds?: number
} {
  const candidate = readRecord(value)
  const heartbeat = Number(candidate.heartbeatTimeoutSeconds)

  return {
    sessionBudget: readOptionalPositiveAmount(candidate.sessionBudget),
    maxPerTransaction: readOptionalPositiveAmount(
      candidate.maxPerTransaction ?? candidate.maxPerCall,
    ),
    autoApproveUnder: readOptionalPositiveAmount(candidate.autoApproveUnder),
    heartbeatTimeoutSeconds:
      Number.isFinite(heartbeat) && heartbeat > 0
        ? Math.round(heartbeat)
    : undefined,
  }
}

function allowUnsafeServiceEndpoints(env: Record<string, string | undefined>): boolean {
  return (
    env.PALMOS_ALLOW_UNSAFE_SERVICE_ENDPOINTS?.trim() === '1' ||
    env.PALMOS_ALLOW_UNSAFE_SERVICE_ENDPOINTS?.trim()?.toLowerCase() === 'true'
  )
}

function normalizeSolanaAddress(value: string): string | undefined {
  try {
    return new PublicKey(value.trim()).toBase58()
  } catch {
    return undefined
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false
  }

  const [first = 0, second = 0] = parts
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

function isUnsafeRegisteredServiceUrl(url: URL): boolean {
  const hostname = normalizeHostname(url.hostname)
  if (
    hostname === 'localhost' ||
    hostname === 'metadata' ||
    hostname === 'metadata.google.internal' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return true
  }

  const ipVersion = isIP(hostname)
  if (ipVersion === 4) {
    return isPrivateIpv4(hostname)
  }

  if (ipVersion === 6) {
    return (
      hostname === '::1' ||
      hostname.startsWith('fc') ||
      hostname.startsWith('fd') ||
      hostname.startsWith('fe80:')
    )
  }

  return false
}

function readRegisteredServiceInput(
  value: unknown,
  env: Record<string, string | undefined>,
): Omit<
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

  const normalizedDestinationAddress = normalizeSolanaAddress(destinationAddress)
  if (!normalizedDestinationAddress) {
    return undefined
  }

  try {
    const parsedUrl = new URL(endpointUrl)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return undefined
    }
    if (
      !allowUnsafeServiceEndpoints(env) &&
      isUnsafeRegisteredServiceUrl(parsedUrl)
    ) {
      return undefined
    }
  } catch {
    return undefined
  }

  return {
    serviceId,
    label,
    vendorId,
    destinationAddress: normalizedDestinationAddress,
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
  const pusdReadinessReports = new FilePusdReadinessReportRegistry(baseDir)
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
      }),
    )
  }

  const app = express()
  const allowedCorsOrigins = buildAllowedCorsOrigins(env)
  app.use(express.json())
  app.use((req, res, next) => {
    const requestOrigin = Array.isArray(req.headers.origin)
      ? req.headers.origin[0]
      : req.headers.origin
    const normalizedOrigin = normalizeOrigin(requestOrigin)

    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-PalmOS-Agent-Key',
    )

    if (normalizedOrigin && allowedCorsOrigins.has(normalizedOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', normalizedOrigin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    if (req.method === 'OPTIONS') {
      res.status(normalizedOrigin && !allowedCorsOrigins.has(normalizedOrigin) ? 403 : 204).end()
      return
    }
    next()
  })

  app.post('/api/waitlist', async (req, res) => {
    try {
      const input = readWaitlistSubmission(req.body)
      if (!input) {
        res.status(400).json({
          ok: false,
          error: 'invalid_waitlist_submission',
        })
        return
      }

      const submission: WaitlistSubmission = {
        ...input,
        id: createId('waitlist'),
        createdAt: new Date().toISOString(),
        source: 'landing',
      }
      await appendWaitlistSubmission(baseDir, submission)

      res.json({
        ok: true,
        message: "You're on the PalmOS waitlist.",
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to join the PalmOS waitlist.',
      })
    }
  })

  app.post('/api/dashboard/judge-access', async (req, res) => {
    const configuredCode = env.PALMOS_JUDGE_ACCESS_CODE?.trim()
    const submittedCode = readMaybeString(req.body?.passcode)

    if (!configuredCode || submittedCode !== configuredCode) {
      res.status(401).json({
        ok: false,
        error: 'invalid_judge_code',
      })
      return
    }

    const expiresAt = Date.now() + 1000 * 60 * 60 * 8
    const maxAge = Math.floor((expiresAt - Date.now()) / 1000)
    const crossSiteCookie = shouldUseCrossSiteJudgeCookie(env)
    const secureCookie = crossSiteCookie ? '; Secure' : ''
    const sameSiteCookie = crossSiteCookie ? '; SameSite=None' : '; SameSite=Lax'
    const sessionToken = signJudgeAccessExpiry(expiresAt, configuredCode)
    res.setHeader(
      'Set-Cookie',
      `palmos_judge_access=${encodeURIComponent(sessionToken)}; Max-Age=${maxAge}; Path=/; HttpOnly${sameSiteCookie}${secureCookie}`,
    )
    res.json({
      ok: true,
      expiresAt,
    })
  })

  app.use('/api/dashboard', (req, res, next) => {
    if (!isPublicAccessMode(env)) {
      next()
      return
    }

    if (
      req.path === '/judge-access' ||
      req.path === '/health'
    ) {
      next()
      return
    }

    const expiresAt = readJudgeAccessExpiry(req, env)
    if (expiresAt > Date.now()) {
      next()
      return
    }

    res.status(401).json({
      ok: false,
      error: 'judge_access_required',
    })
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

  app.post('/api/dashboard/control/dead-man-sweep', async (_req, res) => {
    await runDashboardDeadMansSwitchSweep()
    const snapshot = await buildDashboardSnapshot()
    res.json({
      ok: true,
      snapshot,
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
      const input = readRegisteredServiceInput(req.body, env)
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

  app.post('/api/dashboard/agents/:agentId/services/:serviceId/unallow', async (req, res) => {
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

      const updatedAgent = {
        ...agent,
        updatedAt: new Date().toISOString(),
        policyConfig: {
          ...agent.policyConfig,
          allowedVendors: agent.policyConfig.allowedVendors.filter(
            (vendor) => vendor.vendorId !== service.vendorId,
          ),
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
        },
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to remove service from agent.',
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

      if (result.kind === 'blocked') {
        res.status(403).json({
          ok: false,
          error: result.reason,
          agentId: auth.agent.agentId,
          credentialId: auth.credential.credentialId,
          result: {
            ...result,
            agent: stripAgentSecrets(result.agent),
          },
        })
        return
      }

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
          owsImportPrivateKey: env.OWS_WALLET_PRIVATE_KEY?.trim(),
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

  app.patch('/api/dashboard/agents/:agentId/policy', async (req, res) => {
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

      if (agent.status === 'archived') {
        res.status(409).json({
          ok: false,
          error: 'Archived agents cannot be edited.',
        })
        return
      }

      const patch = readAgentPolicyPatch(req.body)
      const nextMax = patch.maxPerTransaction ?? agent.policyConfig.maxPerTransaction
      const nextAuto =
        patch.autoApproveUnder ?? agent.policyConfig.autoApproveUnder
      const nextBudget =
        patch.sessionBudget ?? agent.policyConfig.sessionBudget

      if (Number(nextAuto) > Number(nextMax)) {
        res.status(400).json({
          ok: false,
          error: 'Auto-approve threshold cannot exceed max per call.',
        })
        return
      }

      if (nextBudget && Number(nextBudget) < Number(nextMax)) {
        res.status(400).json({
          ok: false,
          error: 'Session budget must be greater than or equal to max per call.',
        })
        return
      }

      const updatedAgent = {
        ...agent,
        updatedAt: new Date().toISOString(),
        policyConfig: {
          ...agent.policyConfig,
          sessionBudget: nextBudget,
          maxPerTransaction: nextMax,
          autoApproveUnder: nextAuto,
          heartbeatTimeoutSeconds:
            patch.heartbeatTimeoutSeconds ??
            agent.policyConfig.heartbeatTimeoutSeconds,
        },
      }
      await workspace.agentRegistry.put(updatedAgent)
      const snapshot = await buildDashboardSnapshot()

      res.json({
        ok: true,
        agent: stripAgentSecrets(updatedAgent),
        snapshot,
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to update agent policy.',
      })
    }
  })

  app.post('/api/dashboard/agents/:agentId/actions/:action', async (req, res) => {
    try {
      const agentId = readMaybeString(req.params.agentId)
      const action = readMaybeString(req.params.action)
      if (!agentId || !action) {
        res.status(400).json({
          ok: false,
          error: 'Missing agent id or action.',
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

      const at = new Date().toISOString()
      const wallet = agent.walletId
        ? await workspace.walletRegistry.get(agent.walletId)
        : undefined
      let updatedAgent = agent

      if (action === 'suspend') {
        if (wallet) {
          await workspace.walletRegistry.put({
            ...wallet,
            updatedAt: at,
            state: 'suspended',
          })
        }
        updatedAgent = {
          ...agent,
          updatedAt: at,
          status: 'suspended',
          trustTier: 'restricted',
          walletState: wallet ? 'suspended' : agent.walletState,
        }
      } else if (action === 'reactivate') {
        if (agent.status === 'archived') {
          res.status(409).json({
            ok: false,
            error: 'Archived agents cannot be reactivated.',
          })
          return
        }
        if (wallet) {
          await workspace.walletRegistry.put({
            ...wallet,
            updatedAt: at,
            state: 'active_limited',
          })
        }
        updatedAgent = {
          ...agent,
          updatedAt: at,
          status: 'ready',
          trustTier: agent.trustTier === 'restricted' ? 'new' : agent.trustTier,
          walletState: wallet ? 'active_limited' : agent.walletState,
          lastCheckInAt: at,
        }
      } else if (action === 'archive') {
        if (wallet) {
          await workspace.walletRegistry.put({
            ...wallet,
            updatedAt: at,
            state: 'closed',
          })
        }
        updatedAgent = {
          ...agent,
          updatedAt: at,
          status: 'archived',
          trustTier: 'restricted',
          walletState: wallet ? 'closed' : agent.walletState,
        }
      } else {
        res.status(400).json({
          ok: false,
          error: 'Unsupported agent action.',
        })
        return
      }

      await workspace.agentRegistry.put(updatedAgent)
      const snapshot = await buildDashboardSnapshot()

      res.json({
        ok: true,
        agent: stripAgentSecrets(updatedAgent),
        snapshot,
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to update agent lifecycle.',
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

  app.patch('/api/dashboard/agent-credentials/:credentialId', async (req, res) => {
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

      const label = readMaybeString(req.body?.label)
      if (!label) {
        res.status(400).json({
          ok: false,
          error: 'Missing credential label.',
        })
        return
      }

      const updated = {
        ...credential,
        label,
        updatedAt: new Date().toISOString(),
      }
      await workspace.agentCredentialRegistry.put(updated)

      res.json({
        ok: true,
        credential: sanitizeCredential(updated),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to update agent credential.',
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

  app.post('/api/dashboard/agent-credentials/:credentialId/rotate', async (req, res) => {
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

      if (credential.status === 'revoked') {
        res.status(409).json({
          ok: false,
          error: 'Revoked credentials cannot be rotated.',
        })
        return
      }

      const agent = await workspace.agentRegistry.get(credential.agentId)
      if (!agent) {
        res.status(404).json({
          ok: false,
          error: `Agent ${credential.agentId} was not found.`,
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

      const created = await createAgentCredential(
        {
          credentials: workspace.agentCredentialRegistry,
        },
        {
          agentId: credential.agentId,
          label: readMaybeString(req.body?.label) ?? `${credential.label} rotated`,
        },
      )

      res.json({
        ok: true,
        agent: stripAgentSecrets(agent),
        revoked: sanitizeCredential(revoked),
        credential: sanitizeCredential(created.credential),
        token: created.token,
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to rotate agent credential.',
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

      if (agent.status === 'suspended' || agent.status === 'archived') {
        res.status(409).json({
          ok: false,
          error: `Agent ${agentId} is ${agent.status} and cannot run paid calls.`,
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
          error: 'Select or register an external agent before running PalmOS.',
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

      if (agent.status === 'suspended' || agent.status === 'archived') {
        res.status(409).json({
          ok: false,
          error: `Agent ${agentId} is ${agent.status} and cannot run paid calls.`,
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
      const serviceId = readMaybeString(req.query.serviceId)
      const walletName = readMaybeString(req.query.wallet)
      const explicitPayer = readMaybeString(req.query.payer)
      const agent = agentId ? await workspace.agentRegistry.get(agentId) : undefined
      const agentWallet = agent?.walletId
        ? await workspace.walletRegistry.get(agent.walletId)
        : undefined
      const registeredService = serviceId
        ? await workspace.serviceRegistry.get(serviceId)
        : undefined
      const serviceCatalog = serviceId ? await buildPalmosServiceCatalog() : undefined
      const catalogService = serviceId ? serviceCatalog?.[serviceId] : undefined
      if (serviceId && !catalogService) {
        res.status(404).json({
          ok: false,
          error: `Service ${serviceId} was not found or is disabled.`,
          agentId,
          serviceId,
        })
        return
      }
      const resolvedWalletName =
        walletName ?? agent?.owsWalletName ?? env.PALMOS_READINESS_OWS_WALLET
      const payer =
        explicitPayer ??
        (resolvedWalletName && owsClient?.getSolanaAddress(resolvedWalletName)) ??
        agentWallet?.address?.trim() ??
        undefined
      const recipient =
        readMaybeString(req.query.recipient) ??
        registeredService?.destinationAddress?.trim() ??
        (!serviceId ? env.PUSD_MERCHANT_WALLET?.trim() : undefined) ??
        localServer?.payToAddress
      const amount =
        readMaybeString(req.query.amount) ??
        catalogService?.expectedAmount ??
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
            'Missing payer. Provide ?payer=..., ?wallet=..., or select an agent with a configured wallet.',
          agentId,
          serviceId,
          walletName: resolvedWalletName,
        })
        return
      }

      if (!recipient) {
        res.json({
          ok: false,
          error: serviceId
            ? 'Missing service recipient. Register the service with a destinationAddress or provide ?recipient=... for this readiness check.'
            : 'Missing recipient. Provide ?recipient=... or set PUSD_MERCHANT_WALLET for development checks.',
          agentId,
          serviceId,
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
      const now = new Date().toISOString()
      await pusdReadinessReports.put({
        reportId: createId('pusd_readiness'),
        createdAt: now,
        updatedAt: now,
        agentId,
        serviceId,
        walletName: resolvedWalletName,
        ok: report.ok,
        report,
      })

      res.json({
        ok: report.ok,
        agentId,
        serviceId,
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
    if (!isShowcaseRunEnabled(env)) {
      res.status(404).json({
        ok: false,
        error:
          'Showcase scenario runs are disabled. Set PALMOS_ENABLE_SHOWCASE_RUN=1 in a development workspace to enable this destructive demo route.',
      })
      return
    }

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
          baseDir,
          kernel: workspace.kernel,
          agentRegistry: workspace.agentRegistry,
          paidCalls: workspace.paidCallRegistry,
          palmosClient,
          owsClient,
          serviceCatalog: await buildPalmosServiceCatalog(),
          xmtpNotifier,
          env,
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
