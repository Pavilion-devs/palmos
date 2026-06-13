import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import {
  formatPusdBaseUnits,
  parsePusdAmountToBaseUnits,
} from '../src/integrations/pusd/amount.js'
import { PalmosClient } from '../src/integrations/pusd/client.js'
import { PALMOS_PAYMENT_RAIL } from '../src/integrations/pusd/constants.js'
import { readSolanaKeypairFromEnv } from '../src/integrations/pusd/keypair.js'
import { executePaidServiceCall } from '../src/app/executePaidServiceCall.js'
import { resolvePendingPaidCallApproval } from '../src/app/reviewPendingPaidCall.js'
import { createAgentCredential } from '../src/app/createAgentCredential.js'
import { authenticateAgentCredential } from '../src/app/authenticateAgentCredential.js'
import { commitAgentLifecycleUpdate } from '../src/app/commitAgentLifecycleUpdate.js'
import { validateRegisteredServiceEndpoint } from '../src/server/dashboard/serviceEndpointSafety.js'
import {
  evaluatePalmosServiceReadiness,
  formatServiceReadinessFailure,
} from '../src/server/dashboard/serviceReadiness.js'
import {
  setRegisteredPalmosServiceStatus,
  verifyRegisteredPalmosServiceRecord,
} from '../src/server/dashboard/serviceLifecycle.js'
import {
  createDashboardOperatorRecord,
  readDashboardOperatorPatch,
  sanitizeDashboardOperator,
  setDashboardOperatorStatus,
} from '../src/server/dashboard/operatorLifecycle.js'
import {
  buildDashboardAdminExport,
  createDashboardExportFilename,
} from '../src/server/dashboard/adminExport.js'
import {
  createDashboardRateLimitStore,
  readDashboardJsonBodyLimit,
  readDashboardRateLimitProfiles,
} from '../src/server/dashboard/abuseProtection.js'
import { installDashboardCsrfProtection } from '../src/server/dashboard/csrfProtection.js'
import { buildDashboardApiError } from '../src/server/dashboard/apiErrors.js'
import {
  buildDashboardRequestLogRecord,
  createDashboardRequestId,
} from '../src/server/dashboard/requestTelemetry.js'
import {
  buildDashboardSystemHealth,
  buildPusdConfigHealthChecks,
} from '../src/server/dashboard/systemHealth.js'
import {
  buildDashboardOperationalMetrics,
  createDashboardOperationalMetricsStore,
} from '../src/server/dashboard/operationalMetrics.js'
import {
  createDashboardOperationalAlertDispatcher,
  evaluateDashboardOperationalAlerts,
} from '../src/server/dashboard/operationalAlerts.js'
import {
  createSdkIdempotentExecutionId,
  existingPaidCallToSdkResult,
  isSameSdkIdempotentPayRequest,
  normalizeSdkIdempotencyKey,
} from '../src/server/dashboard/sdkIdempotency.js'
import { createDashboardMutationIdempotencyStore } from '../src/server/dashboard/mutationIdempotency.js'
import {
  SDK_TOOL_DEFINITIONS,
  buildSdkAgentStatus,
  buildSdkPolicyCheck,
  buildSdkServiceSummaries,
  isSdkToolName,
  readSdkToolInput,
} from '../src/server/dashboard/sdkTools.js'
import {
  buildAgentSettlementReadiness,
  buildServiceSettlementReadiness,
} from '../src/server/dashboard/settlementReadiness.js'
import {
  readAgentSettlementModePatch,
  updateAgentSettlementMode,
} from '../src/server/dashboard/agentSettlementMode.js'
import {
  buildPaidCallSettlementRecord,
  buildSolscanTransactionUrl,
} from '../src/app/settlementRecords.js'
import {
  readLocalDemoSettlementPosture,
} from '../src/app/localDemoSettlement.js'
import {
  readAgentPrivacyMode,
  readAgentPrivacyModeFromInput,
  requiresPrivateSettlement,
  updateAgentPrivacyMode,
} from '../src/app/agentPrivacyMode.js'
import {
  reconcilePaidCallSettlement,
  reconcilePaidCallSettlements,
} from '../src/app/reconcileSettlements.js'
import { readRegisteredServiceInput } from '../src/server/dashboard/serviceInput.js'
import {
  createDashboardStorageBackup,
  inspectDashboardStorageBackup,
  restoreDashboardStorageBackup,
} from '../src/server/dashboard/storageBackup.js'
import { scanDashboardJsonHealth } from '../src/server/dashboard/storageStatus.js'
import {
  buildDashboardAccessCapabilities,
  hasDashboardAccess,
  readDashboardAccessIdentity,
  readDashboardSessionIdentity,
  requireDashboardRole,
  signOperatorSession,
} from '../src/server/dashboard/access.js'
import {
  operatorSessionCookie,
  operatorSessionToken,
  TEST_SESSION_SECRET,
} from './helpers/siwsAuth.js'
import { registerSystemRoutes } from '../src/server/dashboard/routes/systemRoutes.js'
import { registerAgentRoutes } from '../src/server/dashboard/routes/agentRoutes.js'
import { registerServiceRoutes } from '../src/server/dashboard/routes/serviceRoutes.js'
import { PALMOS_POSTGRES_MIGRATION_VERSION } from '../src/storage/postgres/schema.js'
import {
  assertPusdPaymentInstructionMatchesPolicy,
  createPusdPaymentRequest,
  toPusdPaymentRequiredResponse,
  validatePusdPaymentInstruction,
} from '../src/integrations/pusd/paymentInstructions.js'
import {
  evaluateSpendRequest,
  type AgentPolicyTemplateInput,
} from '../src/policies/compileAgentPolicy.js'
import { InMemoryAgentRegistry, type AgentRecord } from '../src/store/AgentRegistry.js'
import { InMemoryActionRequestRegistry } from '../src/store/ActionRequestRegistry.js'
import {
  InMemoryPaidCallRegistry,
  type PaidCallRecord,
} from '../src/store/PaidCallRegistry.js'
import { InMemoryAgentCredentialRegistry } from '../src/store/AgentCredentialRegistry.js'
import { InMemoryDashboardAuditLogRegistry } from '../src/store/DashboardAuditLogRegistry.js'
import { InMemoryDashboardOperatorRegistry } from '../src/store/DashboardOperatorRegistry.js'
import { InMemoryDashboardWorkspaceRegistry } from '../src/store/DashboardWorkspaceRegistry.js'
import { FilePusdReadinessReportRegistry } from '../src/store/PusdReadinessReportRegistry.js'
import type { RegisteredPalmosServiceRecord } from '../src/store/PalmosServiceRegistry.js'
import {
  applyDashboardWorkspacePatch,
  ensureDashboardWorkspaceRecord,
  readDashboardWorkspacePatch,
} from '../src/server/dashboard/workspaceSettings.js'
import {
  readJsonFile,
  writeJsonFile,
} from '../runtime/runtime/jsonFile.js'
import {
  formatPusdReadinessFailure,
  type PusdPaymentReadinessReport,
} from '../src/integrations/pusd/readiness.js'
import { fetchWithTimeout } from '../src/integrations/pusd/httpSafety.js'
import {
  mergeRegisteredPalmosServices,
  type PalmosPaidServiceDefinition,
} from '../src/integrations/pusd/serviceCatalog.js'
import { InMemoryWalletRegistry } from '../runtime/wallets/WalletRegistry.js'
import { Keypair } from '@solana/web3.js'

const PUSD_MINT = 'CZzgUBvxaMLwMhVSLgqJn3npmxoTo6nzMNQPAnwtHF3s'

function createCookieRequest(cookie: string) {
  return {
    headers: {
      cookie,
    },
  } as never
}

function createTestResponse() {
  const headers = new Map<string, string>()
  const response = {
    locals: {},
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value)
      return this
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase())
    },
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
  }

  return response
}

function getRouteHandler(
  app: express.Express,
  path: string,
  method: 'get' | 'post' | 'patch' = 'post',
) {
  const layer = app.router.stack.find(
    (entry) =>
      entry.route?.path === path &&
      entry.route?.methods?.[method] === true,
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function', `Missing ${method.toUpperCase()} ${path} route handler`)
  return handler as (
    req: Record<string, unknown>,
    res: ReturnType<typeof createTestResponse>,
  ) => Promise<void> | void
}

async function invokeRoute(input: {
  app: express.Express
  path: string
  method?: 'get' | 'post' | 'patch'
  headers?: Record<string, string>
  params?: Record<string, string>
  query?: Record<string, string>
  body?: unknown
}) {
  const res = createTestResponse()
  const handler = getRouteHandler(input.app, input.path, input.method ?? 'post')
  await handler(
    {
      headers: input.headers ?? {},
      params: input.params ?? {},
      query: input.query ?? {},
      body: input.body,
      method: (input.method ?? 'post').toUpperCase(),
      path: input.path,
    },
    res,
  )
  return res
}

test('parses and formats PUSD amounts at six decimals', () => {
  assert.equal(parsePusdAmountToBaseUnits('0.000001'), 1n)
  assert.equal(parsePusdAmountToBaseUnits('1'), 1_000_000n)
  assert.equal(parsePusdAmountToBaseUnits('12.340005'), 12_340_005n)
  assert.equal(formatPusdBaseUnits(12_340_005n), '12.340005')
  assert.equal(formatPusdBaseUnits(12_000_000n), '12')

  assert.throws(
    () => parsePusdAmountToBaseUnits('0.0000001'),
    /Invalid PUSD amount/,
  )
})

test('dashboard access reads a signed SIWS operator session only while active', () => {
  const now = Date.parse('2026-05-09T12:00:00.000Z')
  const env = {
    PALMOS_PUBLIC_ACCESS_MODE: '1',
    PALMOS_SESSION_SECRET: 'session-secret',
  }

  // No cookie → no access.
  assert.equal(
    hasDashboardAccess({ req: createCookieRequest(''), env, now }),
    false,
  )

  const token = signOperatorSession(
    {
      operatorId: 'op_demo',
      workspaceId: 'palmos_workspace_default',
      role: 'owner',
      expiresAt: now + 60_000,
    },
    'session-secret',
  )
  const sessionReq = () =>
    createCookieRequest(`palmos_operator_session=${encodeURIComponent(token)}`)

  assert.equal(hasDashboardAccess({ req: sessionReq(), env, now }), true)
  assert.deepEqual(
    readDashboardAccessIdentity({ req: sessionReq(), env, now }),
    {
      operatorId: 'op_demo',
      workspaceId: 'palmos_workspace_default',
      actorId: 'operator:op_demo',
      role: 'owner',
      source: 'siws',
      expiresAt: now + 60_000,
    },
  )

  // Expired session → no access.
  const expired = signOperatorSession(
    {
      operatorId: 'op_demo',
      workspaceId: 'palmos_workspace_default',
      role: 'owner',
      expiresAt: now - 1,
    },
    'session-secret',
  )
  assert.equal(
    hasDashboardAccess({
      req: createCookieRequest(
        `palmos_operator_session=${encodeURIComponent(expired)}`,
      ),
      env,
      now,
    }),
    false,
  )

  // Wrong signing secret → no access.
  const forged = signOperatorSession(
    {
      operatorId: 'op_demo',
      workspaceId: 'palmos_workspace_default',
      role: 'owner',
      expiresAt: now + 60_000,
    },
    'different-secret',
  )
  assert.equal(
    hasDashboardAccess({
      req: createCookieRequest(
        `palmos_operator_session=${encodeURIComponent(forged)}`,
      ),
      env,
      now,
    }),
    false,
  )
})

test('dashboard session capabilities expose mutation access explicitly', () => {
  const now = Date.parse('2026-05-09T12:00:00.000Z')

  const capabilitiesFor = (role: 'owner' | 'operator' | 'viewer') =>
    buildDashboardAccessCapabilities({
      identity: {
        operatorId: 'op_test',
        workspaceId: 'palmos_workspace_default',
        actorId: 'operator:op_test',
        role,
        source: 'siws',
        expiresAt: Number.MAX_SAFE_INTEGER,
      },
      env: {},
    })

  assert.deepEqual(capabilitiesFor('owner'), {
    canMutateDashboard: true,
    canManageOperators: true,
  })
  assert.deepEqual(capabilitiesFor('operator'), {
    canMutateDashboard: true,
    canManageOperators: false,
  })
  assert.deepEqual(capabilitiesFor('viewer'), {
    canMutateDashboard: false,
    canManageOperators: false,
  })

  const localIdentity = readDashboardSessionIdentity({
    req: createCookieRequest(''),
    env: {},
    now,
  })
  assert.equal(localIdentity?.role, 'operator')
  assert.equal(
    buildDashboardAccessCapabilities({
      identity: localIdentity,
      env: {},
    }).canMutateDashboard,
    true,
  )
})

test('dashboard abuse protection reads limits and enforces fixed windows', () => {
  assert.equal(readDashboardJsonBodyLimit({}), '256kb')
  assert.equal(
    readDashboardJsonBodyLimit({
      PALMOS_JSON_BODY_LIMIT: '64kb',
      DASHBOARD_JSON_BODY_LIMIT: '128kb',
    }),
    '64kb',
  )

  const profiles = readDashboardRateLimitProfiles({
    PALMOS_RATE_LIMIT_AUTH_MAX: '2',
    PALMOS_RATE_LIMIT_AUTH_WINDOW_MS: '1000',
  })
  assert.equal(profiles.auth.max, 2)
  assert.equal(profiles.auth.windowMs, 1000)
  assert.equal(profiles.sdkPay.max, 120)

  const store = createDashboardRateLimitStore()
  assert.deepEqual(
    store.check({
      key: 'client',
      profile: profiles.auth,
      now: 1_000,
    }),
    {
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAt: 2_000,
      retryAfterMs: 1_000,
    },
  )
  assert.equal(
    store.check({
      key: 'client',
      profile: profiles.auth,
      now: 1_100,
    }).allowed,
    true,
  )
  const blocked = store.check({
    key: 'client',
    profile: profiles.auth,
    now: 1_200,
  })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.remaining, 0)
  assert.equal(blocked.retryAfterMs, 800)
  assert.equal(
    store.check({
      key: 'client',
      profile: profiles.auth,
      now: 2_001,
    }).allowed,
    true,
  )
})

test('dashboard api errors use stable codes and human messages', () => {
  assert.deepEqual(
    buildDashboardApiError({
      code: 'invalid_request',
      message: 'Missing serviceId.',
      requestId: 'req_test_123',
      details: {
        field: 'serviceId',
      },
    }),
    {
      ok: false,
      error: 'invalid_request',
      message: 'Missing serviceId.',
      requestId: 'req_test_123',
      details: {
        field: 'serviceId',
      },
    },
  )
})

test('dashboard csrf protection rejects cross-site mutation origins', async () => {
  const processMetrics = createDashboardOperationalMetricsStore()
  let csrfMiddleware:
    | ((
        req: Record<string, unknown>,
        res: ReturnType<typeof createTestResponse>,
        next: () => void,
      ) => void)
    | undefined
  installDashboardCsrfProtection(
    {
      use(_path: string, handler: typeof csrfMiddleware) {
        csrfMiddleware = handler
      },
    } as never,
    {
      PALMOS_PUBLIC_ACCESS_MODE: '1',
      PALMOS_ALLOWED_ORIGINS: 'https://www.getpalmos.xyz',
    },
    processMetrics,
  )

  assert.ok(csrfMiddleware)

  {
    const res = createTestResponse()
    let nextCalled = false
    csrfMiddleware!(
      {
        method: 'POST',
        path: '/protected-mutation',
        protocol: 'https',
        headers: {
          host: 'www.getpalmos.xyz',
          origin: 'https://attacker.example',
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/json',
        },
      },
      res,
      () => {
        nextCalled = true
      },
    )
    assert.equal(nextCalled, false)
    assert.equal(res.statusCode, 403)
    assert.deepEqual(res.body, {
      ok: false,
      error: 'csrf_check_failed',
      message: 'Dashboard mutation origin could not be verified.',
      details: {
        method: 'POST',
        path: '/protected-mutation',
      },
    })
    assert.equal(processMetrics.snapshot()['dashboard.csrf_failures'], 1)
  }

  {
    const res = createTestResponse()
    let nextCalled = false
    csrfMiddleware!(
      {
        method: 'POST',
        path: '/protected-mutation',
        protocol: 'https',
        headers: {
          host: 'www.getpalmos.xyz',
          origin: 'https://www.getpalmos.xyz',
          'sec-fetch-site': 'same-site',
          'content-type': 'application/json',
        },
      },
      res,
      () => {
        nextCalled = true
      },
    )
    assert.equal(nextCalled, true)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body, undefined)
  }
})

test('dashboard request telemetry creates bounded ids and log records', () => {
  assert.equal(createDashboardRequestId('client-request-123'), 'client-request-123')
  assert.match(createDashboardRequestId('bad id with spaces'), /^req_[\w-]+/)

  assert.deepEqual(
    buildDashboardRequestLogRecord({
      requestId: 'req_test',
      method: 'POST',
      path: '/api/sdk/v1/pay',
      statusCode: 403,
      durationMs: 12.6,
      contentLength: '256',
      userAgent: ['agent-test/1.0'],
    }),
    {
      level: 'info',
      event: 'dashboard.request',
      requestId: 'req_test',
      method: 'POST',
      path: '/api/sdk/v1/pay',
      statusCode: 403,
      durationMs: 13,
      contentLength: 256,
      userAgent: 'agent-test/1.0',
    },
  )

  assert.equal(
    buildDashboardRequestLogRecord({
      requestId: 'req_test',
      method: 'POST',
      path: '/api/sdk/v1/pay',
      statusCode: 500,
      durationMs: 1,
    }).level,
    'warn',
  )
})

test('dashboard system health reports config and storage posture', async () => {
  const pusdChecks = buildPusdConfigHealthChecks({
    PUSD_SOLANA_RPC_URL: 'not-a-url',
    PUSD_MINT: 'not-a-mint',
    PUSD_MERCHANT_WALLET: 'not-a-wallet',
  })
  assert.deepEqual(
    pusdChecks.map((check) => [check.checkId, check.status]),
    [
      ['pusd.rpc_url', 'failed'],
      ['pusd.mint', 'failed'],
      ['pusd.default_recipient', 'failed'],
    ],
  )

  const dir = await mkdtemp(join(tmpdir(), 'palmos-system-health-'))
  try {
    const emptyRegistry = {
      list: async () => [],
    }
    const report = await buildDashboardSystemHealth(
      {
        env: {
          PUSD_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
          PUSD_MINT,
          PUSD_MERCHANT_WALLET: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
          PALMOS_PUBLIC_ACCESS_MODE: '1',
          PALMOS_DISABLE_DASHBOARD_AUTH: '0',
        },
        baseDir: dir,
        workspace: {
          storageDriver: 'file',
          agentRegistry: new InMemoryAgentRegistry(),
          paidCallRegistry: new InMemoryPaidCallRegistry(),
          agentCredentialRegistry: new InMemoryAgentCredentialRegistry(),
          serviceRegistry: emptyRegistry,
          dashboardOperatorRegistry: new InMemoryDashboardOperatorRegistry(),
          dashboardWorkspaceRegistry: new InMemoryDashboardWorkspaceRegistry(),
          dashboardAuditLogRegistry: new InMemoryDashboardAuditLogRegistry(),
          controlEventRegistry: emptyRegistry,
          xmtpAlertRegistry: emptyRegistry,
          owsAccessRegistry: emptyRegistry,
        },
        pusdReadinessReports: new FilePusdReadinessReportRegistry(dir),
        localDemoBaseUrl: 'http://127.0.0.1:4021',
      } as never,
      {
        now: () => '2026-05-09T12:00:00.000Z',
      },
    )

    assert.equal(report.ok, true)
    assert.equal(report.generatedAt, '2026-05-09T12:00:00.000Z')
    assert.equal(
      report.checks.find((check) => check.checkId === 'storage')?.status,
      'passed',
    )
    assert.equal(
      report.checks.find((check) => check.checkId === 'dashboard.auth')?.status,
      'passed',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('dashboard system health reports Postgres connectivity and backup freshness', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-postgres-health-'))
  try {
    await writeFile(
      join(dir, 'postgres-backup-status.json'),
      JSON.stringify({
        ok: true,
        createdAt: '2026-05-09T11:30:00.000Z',
        backupPath: '/var/backups/palmos-postgres/palmos-test.sql.gz',
        retentionDays: 14,
      }),
    )

    const emptyRegistry = {
      list: async () => [],
    }
    const postgresPool = {
      query: async (sql: string) => ({
        rows: sql.includes('palmos_schema_migrations')
          ? [{ version: PALMOS_POSTGRES_MIGRATION_VERSION }]
          : [{ ok: 1 }],
      }),
    }

    const report = await buildDashboardSystemHealth(
      {
        env: {
          PUSD_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
          PUSD_MINT,
          PALMOS_POSTGRES_BACKUP_MAX_AGE_HOURS: '36',
        },
        baseDir: dir,
        workspace: {
          storageDriver: 'postgres',
          postgresPool,
          agentRegistry: new InMemoryAgentRegistry(),
          paidCallRegistry: new InMemoryPaidCallRegistry(),
          agentCredentialRegistry: new InMemoryAgentCredentialRegistry(),
          serviceRegistry: emptyRegistry,
          dashboardOperatorRegistry: new InMemoryDashboardOperatorRegistry(),
          dashboardWorkspaceRegistry: new InMemoryDashboardWorkspaceRegistry(),
          dashboardAuditLogRegistry: new InMemoryDashboardAuditLogRegistry(),
          controlEventRegistry: emptyRegistry,
          xmtpAlertRegistry: emptyRegistry,
          owsAccessRegistry: emptyRegistry,
        },
        pusdReadinessReports: new FilePusdReadinessReportRegistry(dir),
        localDemoBaseUrl: 'http://127.0.0.1:4021',
      } as never,
      {
        now: () => '2026-05-09T12:00:00.000Z',
      },
    )

    assert.equal(report.ok, true)
    assert.equal(
      report.checks.find((check) => check.checkId === 'storage')?.summary,
      'Postgres storage health checks passed.',
    )
    assert.equal(
      report.checks.find((check) => check.checkId === 'postgres.connection')
        ?.status,
      'passed',
    )
    assert.equal(
      report.checks.find((check) => check.checkId === 'postgres.backup')
        ?.status,
      'passed',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('dashboard operational metrics summarize process and stored records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-operational-metrics-'))
  try {
    const processMetrics = createDashboardOperationalMetricsStore()
    processMetrics.increment('sdk.calls')
    processMetrics.increment('sdk.calls')
    processMetrics.increment('sdk.auth_failures')
    processMetrics.increment('sdk.policy_denials')
    processMetrics.increment('dashboard.db_failures')
    processMetrics.recordHttpStatus(200, Date.parse('2026-05-09T12:09:00.000Z'))
    processMetrics.recordHttpStatus(503, Date.parse('2026-05-09T12:09:30.000Z'))

    const paidCalls = new InMemoryPaidCallRegistry([
      {
        executionId: 'paid_call_policy',
        createdAt: '2026-05-09T12:00:00.000Z',
        updatedAt: '2026-05-09T12:00:01.000Z',
        agentId: 'agent_test',
        serviceId: 'service_test',
        vendorId: 'vendor_test',
        paymentRail: PALMOS_PAYMENT_RAIL,
        amount: '0.01',
        assetSymbol: 'PUSD',
        status: 'blocked',
        requestPayload: {},
        requestSummary: {},
        errorCode: 'policy.blocked',
      },
      {
        executionId: 'paid_call_failed',
        createdAt: '2026-05-09T12:00:00.000Z',
        updatedAt: '2026-05-09T12:00:05.000Z',
        agentId: 'agent_test',
        serviceId: 'service_test',
        vendorId: 'vendor_test',
        paymentRail: PALMOS_PAYMENT_RAIL,
        amount: '0.02',
        assetSymbol: 'PUSD',
        status: 'failed',
        runId: 'run_failed',
        requestPayload: {},
        requestSummary: {},
        errorCode: 'palmos.client_not_configured',
      },
      {
        executionId: 'paid_call_pending',
        createdAt: '2026-05-09T12:00:00.000Z',
        updatedAt: '2026-05-09T12:00:00.000Z',
        agentId: 'agent_test',
        serviceId: 'service_test',
        vendorId: 'vendor_test',
        paymentRail: 'umbra',
        amount: '0.03',
        assetSymbol: 'PUSD',
        status: 'approval_pending',
        runId: 'run_pending',
        requestPayload: {},
        requestSummary: {},
      },
      {
        executionId: 'paid_call_approval_failed',
        createdAt: '2026-05-09T12:00:00.000Z',
        updatedAt: '2026-05-09T12:00:07.000Z',
        agentId: 'agent_test',
        serviceId: 'service_test',
        vendorId: 'vendor_test',
        paymentRail: PALMOS_PAYMENT_RAIL,
        amount: '0.04',
        assetSymbol: 'PUSD',
        status: 'failed',
        runId: 'run_approval_failed',
        requestPayload: {},
        requestSummary: {},
        errorCode: 'approval.review_failed',
      },
    ])
    const credentials = new InMemoryAgentCredentialRegistry([
      {
        credentialId: 'credential_active',
        agentId: 'agent_test',
        createdAt: '2026-05-09T12:00:00.000Z',
        updatedAt: '2026-05-09T12:00:00.000Z',
        label: 'Active',
        keyPrefix: 'palmos_live',
        keyHash: 'hash_active',
        status: 'active',
        lastUsedAt: '2026-05-09T12:01:00.000Z',
      },
      {
        credentialId: 'credential_revoked',
        agentId: 'agent_test',
        createdAt: '2026-05-09T12:00:00.000Z',
        updatedAt: '2026-05-09T12:00:00.000Z',
        label: 'Revoked',
        keyPrefix: 'palmos_old',
        keyHash: 'hash_revoked',
        status: 'revoked',
      },
    ])
    const readinessReports = new FilePusdReadinessReportRegistry(dir)
    const baseReport: PusdPaymentReadinessReport = {
      ok: false,
      rpcUrl: 'https://api.mainnet-beta.solana.com',
      payer: 'payer',
      recipient: 'recipient',
      mint: PUSD_MINT,
      amount: '0.01',
      amountBaseUnits: '10000',
      tokenProgramId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      checks: [],
    }
    await readinessReports.put({
      reportId: 'readiness_failed',
      createdAt: '2026-05-09T12:00:00.000Z',
      updatedAt: '2026-05-09T12:00:00.000Z',
      ok: false,
      report: baseReport,
    })
    const actionRequests = new InMemoryActionRequestRegistry([
      {
        actionRequestId: 'action_transfer_pending',
        createdAt: '2026-05-09T12:00:00.000Z',
        updatedAt: '2026-05-09T12:00:00.000Z',
        agentId: 'agent_test',
        source: 'sdk',
        kind: 'asset.transfer',
        status: 'approval_pending',
        target: {
          kind: 'address',
          address: 'recipient',
          chainId: 'solana-mainnet',
        },
        value: {
          assetSymbol: 'PUSD',
          amount: '0.25',
          chainId: 'solana-mainnet',
        },
        title: 'Transfer 0.25 PUSD',
        summary: 'Requested transfer.',
        requestPayload: {},
        policy: {
          approvalRequired: true,
        },
      },
      {
        actionRequestId: 'action_transfer_blocked',
        createdAt: '2026-05-09T12:00:00.000Z',
        updatedAt: '2026-05-09T12:00:01.000Z',
        agentId: 'agent_test',
        source: 'sdk',
        kind: 'asset.transfer',
        status: 'blocked',
        target: {
          kind: 'address',
          address: 'recipient',
          chainId: 'solana-mainnet',
        },
        value: {
          assetSymbol: 'PUSD',
          amount: '0.25',
          chainId: 'solana-mainnet',
        },
        title: 'Transfer 0.25 PUSD',
        summary: 'Requested transfer.',
        requestPayload: {},
        policy: {
          approvalRequired: false,
        },
        errorCode: 'policy.destination_not_allowed',
      },
      {
        actionRequestId: 'action_wallet_policy_stale',
        createdAt: '2026-05-09T12:00:00.000Z',
        updatedAt: '2026-05-09T12:00:00.000Z',
        agentId: 'agent_test',
        source: 'dashboard',
        kind: 'wallet.policy_update',
        status: 'created',
        target: {
          kind: 'wallet',
          walletId: 'wallet_test',
          chainId: 'solana-mainnet',
        },
        title: 'Update wallet policy',
        summary: 'Pending wallet policy update.',
        requestPayload: {},
        policy: {
          approvalRequired: false,
        },
      },
      {
        actionRequestId: 'action_wallet_policy_failed',
        createdAt: '2026-05-09T12:00:00.000Z',
        updatedAt: '2026-05-09T12:05:00.000Z',
        agentId: 'agent_test',
        source: 'dashboard',
        kind: 'wallet.policy_update',
        status: 'failed',
        target: {
          kind: 'wallet',
          walletId: 'wallet_test',
          chainId: 'solana-mainnet',
        },
        title: 'Update wallet policy',
        summary: 'Wallet policy update failed.',
        requestPayload: {},
        policy: {
          approvalRequired: false,
        },
        errorCode: 'action.lifecycle_timeout',
      },
    ])

    const report = await buildDashboardOperationalMetrics({
      paidCalls,
      actionRequests,
      credentials,
      readinessReports,
      processMetrics,
      now: () => '2026-05-09T12:10:00.000Z',
    })

    assert.equal(report.generatedAt, '2026-05-09T12:10:00.000Z')
    assert.equal(report.processCounters['sdk.calls'], 2)
    assert.equal(report.processCounters['sdk.auth_failures'], 1)
    assert.equal(report.processCounters['sdk.policy_denials'], 1)
    assert.equal(report.processCounters['dashboard.db_failures'], 1)
    assert.equal(report.processCounters['dashboard.5xx'], 1)
    assert.equal(report.http.recentRequests, 2)
    assert.equal(report.http.recent5xx, 1)
    assert.equal(report.paidCalls.total, 4)
    assert.equal(report.paidCalls.byStatus.blocked, 1)
    assert.equal(report.paidCalls.byStatus.failed, 2)
    assert.equal(report.paidCalls.byRail[PALMOS_PAYMENT_RAIL], 3)
    assert.equal(report.paidCalls.byRail.umbra, 1)
    assert.equal(report.paidCalls.policyDenials, 1)
    assert.equal(report.paidCalls.settlementFailures, 1)
    assert.equal(report.actionRequests.nativeTotal, 4)
    assert.equal(report.actionRequests.byKind['asset.transfer'], 2)
    assert.equal(report.actionRequests.byKind['wallet.policy_update'], 2)
    assert.equal(report.actionRequests.byStatus.approval_pending, 1)
    assert.equal(report.actionRequests.policyDenials, 1)
    assert.equal(report.actionRequests.executionFailures, 1)
    assert.equal(report.walletActions.total, 4)
    assert.equal(report.walletActions.byKind['asset.transfer'], 2)
    assert.equal(report.walletActions.byKind['wallet.policy_update'], 2)
    assert.equal(report.walletActions.byStatus.created, 1)
    assert.equal(report.walletActions.failedTotal, 1)
    assert.equal(report.walletActions.failedRate, 0.25)
    assert.equal(report.walletActions.stuckTotal, 1)
    assert.equal(report.walletActions.stuckByKind['wallet.policy_update'], 1)
    assert.equal(report.walletActions.approvalPending.total, 1)
    assert.equal(report.walletActions.approvalPending.averageAgeMs, 600000)
    assert.equal(report.walletActions.approvalPending.maxAgeMs, 600000)
    assert.equal(report.approvals.pending, 2)
    assert.equal(report.approvals.resolvedSamples, 2)
    assert.equal(report.approvals.averageLatencyMs, 6000)
    assert.equal(report.approvals.executionFailures, 1)
    assert.equal(report.readiness.failedReports, 1)
    assert.equal(report.readiness.latestOk, false)
    assert.equal(report.credentials.active, 1)
    assert.equal(report.credentials.revoked, 1)
    assert.equal(report.credentials.neverUsed, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('dashboard operational alerts evaluate and dedupe delivery', async () => {
  const metrics = {
    ok: true,
    generatedAt: '2026-05-09T12:10:00.000Z',
    processCounters: {
      'sdk.calls': 0,
      'sdk.auth_failures': 0,
      'sdk.policy_denials': 0,
      'sdk.internal_failures': 0,
      'dashboard.5xx': 2,
      'dashboard.backup_failures': 1,
      'dashboard.csrf_failures': 11,
      'dashboard.db_failures': 1,
      'approval.execution_failures': 1,
    },
    paidCalls: {
      total: 0,
      byStatus: {
        blocked: 0,
        approval_pending: 0,
        waiting_for_execution: 0,
        executed: 0,
        failed: 0,
      },
      byRail: {},
      policyDenials: 0,
      settlementFailures: 0,
    },
    actionRequests: {
      total: 0,
      nativeTotal: 0,
      byStatus: {},
      byKind: {},
      policyDenials: 0,
      executionFailures: 0,
    },
    walletActions: {
      total: 0,
      byStatus: {},
      byKind: {},
      stuckThresholdMs: 300_000,
      stuckTotal: 0,
      stuckByStatus: {},
      stuckByKind: {},
      failedTotal: 0,
      failedRate: 0,
      approvalPending: {
        total: 0,
      },
    },
    approvals: {
      pending: 0,
      resolvedSamples: 0,
      executionFailures: 1,
    },
    http: {
      windowMs: 300_000,
      recentRequests: 12,
      recent5xx: 2,
    },
    readiness: {
      totalReports: 0,
      failedReports: 0,
    },
    credentials: {
      total: 0,
      active: 0,
      revoked: 0,
      neverUsed: 0,
    },
  } satisfies Awaited<ReturnType<typeof buildDashboardOperationalMetrics>>
  const alerts = evaluateDashboardOperationalAlerts({
    env: {
      PALMOS_ALERT_RECENT_5XX_THRESHOLD: '1',
      PALMOS_ALERT_CSRF_FAILURE_THRESHOLD: '10',
    },
    metrics,
    health: {
      ok: false,
      generatedAt: metrics.generatedAt,
      checks: [
        {
          checkId: 'postgres.backup',
          status: 'failed',
          summary: 'Postgres backup status is stale.',
        },
      ],
    },
  })

  assert.deepEqual(
    alerts.map((alert) => alert.alertId).sort(),
    [
      'approval.execution_failures',
      'dashboard.backup_failures',
      'dashboard.csrf_failures',
      'dashboard.db_failures',
      'dashboard.http_5xx_recent',
      'health.postgres.backup',
    ],
  )

  let nowMs = Date.parse(metrics.generatedAt)
  const webhookPayloads: unknown[] = []
  const dispatcher = createDashboardOperationalAlertDispatcher({
    env: {
      PALMOS_ALERT_LOGS: '0',
      PALMOS_ALERT_WEBHOOK_URL: 'https://alerts.example.com/palmos',
      PALMOS_ALERT_MIN_INTERVAL_MS: '60000',
    },
    nowMs: () => nowMs,
    fetchImpl: async (_url, init) => {
      webhookPayloads.push(JSON.parse(String(init?.body)))
      return new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    },
  })

  await dispatcher.dispatch(alerts)
  await dispatcher.dispatch(alerts)
  nowMs += 60_001
  await dispatcher.dispatch(alerts.slice(0, 1))

  assert.equal(webhookPayloads.length, 2)
  assert.equal((webhookPayloads[0] as { alerts: unknown[] }).alerts.length, 6)
  assert.equal((webhookPayloads[1] as { alerts: unknown[] }).alerts.length, 1)
})

test('SDK pay idempotency normalizes keys and replays matching executions', () => {
  const agent = createTestAgent()
  const executionId = createSdkIdempotentExecutionId({
    agentId: agent.agentId,
    idempotencyKey: 'retry-key-123',
  })
  const execution: PaidCallRecord = {
    executionId,
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:05.000Z',
    agentId: agent.agentId,
    serviceId: 'local.pusd.spot_price',
    vendorId: 'local_pusd_demo',
    paymentRail: PALMOS_PAYMENT_RAIL,
    amount: '0.01',
    assetSymbol: 'PUSD',
    status: 'executed',
    requestPayload: {
      quote: 'USD',
      base: 'BTC',
    },
    requestSummary: {},
  }

  assert.equal(normalizeSdkIdempotencyKey('retry-key-123'), 'retry-key-123')
  assert.equal(normalizeSdkIdempotencyKey('bad key'), undefined)
  assert.match(executionId, /^paid_call_idem_/)
  assert.equal(
    createSdkIdempotentExecutionId({
      agentId: agent.agentId,
      idempotencyKey: 'retry-key-123',
    }),
    executionId,
  )
  assert.equal(
    isSameSdkIdempotentPayRequest({
      execution,
      serviceId: 'local.pusd.spot_price',
      amount: '0.01',
      request: {
        base: 'BTC',
        quote: 'USD',
      },
    }),
    true,
  )
  assert.equal(
    isSameSdkIdempotentPayRequest({
      execution,
      serviceId: 'local.pusd.spot_price',
      amount: '0.02',
      request: {
        base: 'BTC',
        quote: 'USD',
      },
    }),
    false,
  )
  assert.equal(
    existingPaidCallToSdkResult({
      agent,
      execution,
    }).kind,
    'executed',
  )
})

test('dashboard mutation idempotency replays completed mutations', () => {
  const store = createDashboardMutationIdempotencyStore({
    ttlMs: 60_000,
    maxEntries: 10,
  })
  const input = {
    actorId: 'operator:demo',
    operation: 'agent_credential.rotate',
    targetId: 'credential_123',
    idempotencyKey: 'retry-key-123',
    fingerprint: 'same-request',
  }

  const reservation = store.reserve(input)
  assert.equal(reservation.kind, 'reserved')
  if (reservation.kind !== 'reserved') {
    throw new Error('Expected idempotency reservation.')
  }

  const response = {
    statusCode: 200,
    body: {
      ok: true,
      token: 'palmos_test_token',
    },
  }
  store.complete(reservation, response)

  assert.deepEqual(store.reserve(input), {
    kind: 'replay',
    response,
  })
  assert.deepEqual(
    store.reserve({
      ...input,
      fingerprint: 'different-request',
    }),
    {
      kind: 'conflict',
      reason: 'fingerprint_mismatch',
    },
  )
})

test('SDK tool helpers expose services, status, and policy checks', () => {
  const agent = createTestAgent()
  const credential = {
    credentialId: 'cred_test',
    agentId: agent.agentId,
    label: 'Test credential',
    keyHash: 'hash_test',
    keyPrefix: 'palmos_test',
    status: 'active' as const,
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
  }

  assert.deepEqual(
    SDK_TOOL_DEFINITIONS.map((tool) => tool.name),
    [
      'list_services',
      'request_paid_service',
      'request_asset_transfer',
      'get_byreal_quote',
      'request_asset_swap',
      'list_byreal_positions',
      'request_liquidity_action',
      'check_policy',
      'get_agent_status',
      'get_wallet_context',
    ],
  )
  assert.equal(isSdkToolName('check_policy'), true)
  assert.equal(isSdkToolName('unknown_tool'), false)
  assert.deepEqual(readSdkToolInput({ input: { serviceId: 'svc_test' } }), {
    serviceId: 'svc_test',
  })

  assert.deepEqual(
    buildSdkServiceSummaries({
      agent,
      serviceCatalog: {
        [budgetService.serviceId]: budgetService,
        [unallowedService.serviceId]: unallowedService,
      },
    }).map((service) => ({
      serviceId: service.serviceId,
      allowed: service.allowed,
    })),
    [
      {
        serviceId: 'local.pusd.spot_price',
        allowed: true,
      },
      {
        serviceId: 'custom.pusd.unallowed',
        allowed: false,
      },
    ],
  )

  assert.deepEqual(
    buildSdkPolicyCheck({
      agent,
      serviceCatalog: {
        [budgetService.serviceId]: budgetService,
      },
      serviceId: budgetService.serviceId,
    }),
    {
      ok: true,
      agentId: agent.agentId,
      serviceId: budgetService.serviceId,
      vendorId: budgetService.vendorId,
      amount: budgetService.expectedAmount,
      allowed: true,
      status: 'allowed',
      requiresApproval: false,
      reasonCode: 'policy.auto_approved',
      effectiveMaxPerTransaction: '1.00',
    },
  )

  assert.equal(
    buildSdkPolicyCheck({
      agent,
      serviceCatalog: {
        [budgetService.serviceId]: budgetService,
      },
      serviceId: 'missing.service',
    }),
    undefined,
  )

  assert.deepEqual(buildSdkAgentStatus({ agent, credential }).status, {
    agentId: agent.agentId,
    agentStatus: 'ready',
    credentialStatus: 'active',
    trustTier: 'healthy',
    settlementMode: 'local-demo',
    walletState: 'active_limited',
    lastCheckInAt: '2026-05-09T12:00:00.000Z',
  })
})

test('settlement records normalize rail, account, and explorer metadata', () => {
  const signature = '1'.repeat(88)
  const recipient = '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy'
  const record = buildPaidCallSettlementRecord({
    rail: PALMOS_PAYMENT_RAIL,
    mode: 'real-solana',
    amount: '0.01',
    assetSymbol: 'PUSD',
    network: 'solana-mainnet',
    mint: PUSD_MINT,
    payer: recipient,
    recipient,
    reference: 'pusd_pay_req_test',
    signature,
    explorerUrl: buildSolscanTransactionUrl(signature, 'solana-mainnet'),
    confirmedAt: '2026-05-09T12:00:00.000Z',
  })

  assert.equal(record.source, 'real-solana')
  assert.equal(record.confirmationStatus, 'confirmed')
  assert.equal(record.signature, signature)
  assert.equal(record.explorerUrl, `https://solscan.io/tx/${signature}`)
  assert.equal(record.payerTokenAccount, record.recipientTokenAccount)
  assert.ok(record.recipientTokenAccount)

  assert.equal(
    buildPaidCallSettlementRecord({
      rail: PALMOS_PAYMENT_RAIL,
      mode: 'local-demo',
      amount: '0.01',
      assetSymbol: 'PUSD',
    }).confirmationStatus,
    'not_applicable',
  )
})

test('settlement reconciliation updates local and verified records', async () => {
  const checkedAt = '2026-05-09T12:30:00.000Z'
  const signature = '2'.repeat(88)
  const localRecord: PaidCallRecord = {
    executionId: 'paid_call_local_reconcile',
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    agentId: 'agent_reconcile',
    serviceId: 'local.pusd.spot_price',
    vendorId: 'local_pusd_demo',
    paymentRail: PALMOS_PAYMENT_RAIL,
    settlementMode: 'local-demo',
    amount: '0.01',
    assetSymbol: 'PUSD',
    chainId: 'solana-mainnet',
    transactionSignature: 'palmos_demo_test',
    status: 'executed',
    requestPayload: {},
    requestSummary: {},
    settlement: buildPaidCallSettlementRecord({
      rail: PALMOS_PAYMENT_RAIL,
      mode: 'local-demo',
      amount: '0.01',
      assetSymbol: 'PUSD',
      signature: 'palmos_demo_test',
    }),
  }
  const realRecord: PaidCallRecord = {
    ...localRecord,
    executionId: 'paid_call_real_reconcile',
    settlementMode: 'real-solana',
    transactionSignature: signature,
    settlement: buildPaidCallSettlementRecord({
      rail: PALMOS_PAYMENT_RAIL,
      mode: 'real-solana',
      amount: '0.01',
      assetSymbol: 'PUSD',
      network: 'solana-mainnet',
      signature,
    }),
  }
  const registry = new InMemoryPaidCallRegistry([localRecord, realRecord])

  const localResult = await reconcilePaidCallSettlement({
    record: localRecord,
    registry,
    now: () => checkedAt,
  })
  assert.equal(localResult.changed, true)
  assert.equal(localResult.skipped, true)
  assert.equal(localResult.reason, 'local_demo')
  assert.equal(
    (await registry.get(localRecord.executionId))?.settlement?.reconciliationStatus,
    'not_applicable',
  )

  const realResult = await reconcilePaidCallSettlement({
    record: realRecord,
    registry,
    now: () => checkedAt,
    verifier: async () => ({
      confirmationStatus: 'confirmed',
      signature,
      explorerUrl: `https://solscan.io/tx/${signature}`,
      confirmedAt: checkedAt,
    }),
  })
  assert.equal(realResult.changed, true)
  assert.equal(realResult.skipped, false)
  assert.equal(realResult.record.settlement?.confirmationStatus, 'confirmed')
  assert.equal(realResult.record.settlement?.reconciliationStatus, 'matched')
  assert.equal(realResult.record.settlement?.reconciledAt, checkedAt)
  assert.equal(realResult.record.transactionExplorerUrl, `https://solscan.io/tx/${signature}`)
})

test('settlement reconciliation batch tracks pending and skipped records', async () => {
  const checkedAt = '2026-05-09T12:35:00.000Z'
  const pendingRecord: PaidCallRecord = {
    executionId: 'paid_call_pending_reconcile',
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    agentId: 'agent_reconcile',
    serviceId: 'local.pusd.spot_price',
    vendorId: 'local_pusd_demo',
    paymentRail: PALMOS_PAYMENT_RAIL,
    settlementMode: 'real-solana',
    amount: '0.01',
    assetSymbol: 'PUSD',
    chainId: 'solana-mainnet',
    status: 'executed',
    requestPayload: {},
    requestSummary: {},
    settlement: buildPaidCallSettlementRecord({
      rail: PALMOS_PAYMENT_RAIL,
      mode: 'real-solana',
      amount: '0.01',
      assetSymbol: 'PUSD',
    }),
  }
  const blockedRecord: PaidCallRecord = {
    ...pendingRecord,
    executionId: 'paid_call_blocked_reconcile',
    status: 'blocked',
  }
  const registry = new InMemoryPaidCallRegistry([pendingRecord, blockedRecord])

  const result = await reconcilePaidCallSettlements({
    registry,
    now: () => checkedAt,
  })

  assert.equal(result.checked, 2)
  assert.equal(result.changed, 1)
  assert.equal(result.skipped, 2)
  assert.equal(
    (await registry.get(pendingRecord.executionId))?.settlement
      ?.reconciliationStatus,
    'pending',
  )
  assert.equal(
    (await registry.get(pendingRecord.executionId))?.settlement
      ?.reconciliationError,
    'Settlement has no transaction signature yet.',
  )
  assert.equal(
    result.results.find((item) => item.executionId === blockedRecord.executionId)
      ?.reason,
    'not_executed',
  )
})

test('settlement readiness summarizes agent rail configuration', () => {
  const agent = createTestAgent({
    settlementMode: 'real-solana',
  })
  const wallet = {
    walletId: agent.walletId!,
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    state: 'active_limited' as const,
    organizationId: agent.organizationId,
    address: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
    supportedChains: ['solana-mainnet'],
    complianceStatus: 'approved' as const,
    policyAttachmentStatus: 'attached' as const,
    signerHealthStatus: 'healthy' as const,
    trustStatus: 'sufficient' as const,
  }

  const blocked = buildAgentSettlementReadiness({
    agent,
    wallet,
    env: {
      PUSD_MINT,
      PUSD_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
    },
  })
  assert.equal(blocked.status, 'blocked')
  assert.equal(
    blocked.checks.some((item) => item.code === 'signer.not_configured'),
    true,
  )

  const ready = buildAgentSettlementReadiness({
    agent,
    wallet,
    env: {
      PUSD_MINT,
      PUSD_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
      PUSD_AGENT_KEYPAIR_PATH: '/secure/payer.json',
    },
  })
  assert.equal(ready.status, 'ready')
  assert.equal(ready.walletAddress, wallet.address)
})

test('settlement readiness prefers OWS Solana address over generic wallet address', () => {
  const agent = createTestAgent({
    settlementMode: 'ows',
    walletBackend: 'ows',
    owsWalletName: 'intel-agent',
  })
  const wallet = {
    walletId: agent.walletId!,
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    state: 'active_limited' as const,
    organizationId: agent.organizationId,
    address: '0xC8E7C9d8D16Bb3BaB84bBD17c298DCCC5DaE0eef',
    supportedChains: ['solana-mainnet'],
    complianceStatus: 'approved' as const,
    policyAttachmentStatus: 'attached' as const,
    signerHealthStatus: 'healthy' as const,
    trustStatus: 'sufficient' as const,
  }
  const owsSolanaAddress = 'Dc12XGCWDcnxpjDsYuz89vFqYJ4YHxYb3dvGFBC22MdL'
  const readiness = buildAgentSettlementReadiness({
    agent,
    wallet,
    owsClient: {
      getSolanaAddress: (name: string) =>
        name === 'intel-agent' ? owsSolanaAddress : undefined,
    } as never,
    env: {
      PUSD_MINT,
      PUSD_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
      OWS_WALLET_PRIVATE_KEY: 'configured',
    },
  })

  assert.equal(readiness.status, 'ready')
  assert.equal(readiness.walletAddress, owsSolanaAddress)
  assert.equal(readiness.owsSolanaAddress, owsSolanaAddress)
})

test('settlement readiness summarizes service local and real modes', async () => {
  const service: PalmosPaidServiceDefinition<Record<string, unknown>> = {
    serviceId: 'custom.readiness.summary',
    label: 'Readiness Summary Service',
    vendorId: 'readiness_vendor',
    chainId: 'solana-mainnet',
    assetSymbol: 'PUSD',
    expectedAmount: '0.01',
    paymentRail: PALMOS_PAYMENT_RAIL,
    source: 'registered',
    verificationStatus: 'unchecked',
    buildRequest: () => ({
      url: 'https://payments.example.com/api',
      init: { method: 'POST' },
      requestSummary: {},
    }),
  }
  const registeredService: RegisteredPalmosServiceRecord = {
    serviceId: service.serviceId,
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    label: service.label,
    vendorId: service.vendorId,
    destinationAddress: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
    endpointUrl: 'https://payments.example.com/api',
    method: 'POST',
    requestMode: 'json',
    expectedAmount: service.expectedAmount,
    chainId: 'solana-mainnet',
    status: 'active',
    verificationStatus: 'unchecked',
  }

  const result = await buildServiceSettlementReadiness({
    service,
    registeredService,
    env: {},
  })

  assert.equal(result.modes['local-demo'].status, 'ready')
  assert.equal(result.modes['real-solana'].status, 'blocked')
  assert.equal(
    result.modes['real-solana'].checks.some(
      (item) => item.code === 'service.unverified',
    ),
    true,
  )
})

test('agent settlement mode updates are explicit and validated', () => {
  const agent = createTestAgent()

  assert.deepEqual(readAgentSettlementModePatch({ walletMode: 'real-solana' }), {
    settlementMode: 'real-solana',
  })
  assert.deepEqual(readAgentSettlementModePatch({ settlementMode: 'bad-mode' }), {
    settlementMode: undefined,
  })

  const realSolana = updateAgentSettlementMode({
    agent,
    settlementMode: 'real-solana',
    now: () => '2026-05-09T12:40:00.000Z',
  })
  assert.equal(realSolana.ok, true)
  assert.equal(realSolana.ok && realSolana.changed, true)
  assert.equal(realSolana.ok && realSolana.agent.settlementMode, 'real-solana')
  assert.equal(realSolana.ok && realSolana.agent.updatedAt, '2026-05-09T12:40:00.000Z')

  const missingOws = updateAgentSettlementMode({
    agent,
    settlementMode: 'ows',
  })
  assert.equal(missingOws.ok, false)
  assert.equal(!missingOws.ok && missingOws.code, 'ows_wallet_required')

  const archived = updateAgentSettlementMode({
    agent: {
      ...agent,
      status: 'archived',
    },
    settlementMode: 'local-demo',
  })
  assert.equal(archived.ok, false)
  assert.equal(!archived.ok && archived.code, 'archived_agent')
})

test('local-demo settlement is blocked in production-like environments', async () => {
  assert.deepEqual(
    readLocalDemoSettlementPosture({
      NODE_ENV: 'production',
    }),
    {
      allowed: false,
      productionLike: true,
      overrideEnabled: false,
      reason:
        'Local-demo settlement is blocked in production-like environments. Use real-solana or ows, or set PALMOS_ALLOW_LOCAL_DEMO_SETTLEMENT_IN_PRODUCTION=1 only for a controlled demo.',
    },
  )
  assert.equal(
    readLocalDemoSettlementPosture({
      NODE_ENV: 'production',
      PALMOS_ALLOW_LOCAL_DEMO_SETTLEMENT_IN_PRODUCTION: '1',
    }).allowed,
    true,
  )

  const agent = createTestAgent({
    settlementMode: 'local-demo',
  })
  const result = await executePaidServiceCall(
    {
      kernel: fakeKernel as never,
      agentRegistry: new InMemoryAgentRegistry([agent]),
      paidCalls: new InMemoryPaidCallRegistry(),
      palmosClient: fakePalmosClient as never,
      serviceCatalog: {
        [budgetService.serviceId]: budgetService,
      },
      createId: () => 'paid_call_local_demo_prod_blocked',
      now: () => '2026-05-09T12:45:00.000Z',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      agentId: agent.agentId,
      serviceId: budgetService.serviceId,
      request: {},
      amount: '0.01',
    },
  )

  assert.equal(result.kind, 'execution_failed')
  assert.equal(result.execution.status, 'failed')
  assert.equal(result.execution.errorCode, 'palmos.local_demo_not_allowed')
})

test('agent privacy mode updates attach private settlement policy', () => {
  const agent = createTestAgent()

  assert.equal(readAgentPrivacyMode(agent.policyConfig), 'disabled')
  assert.equal(readAgentPrivacyModeFromInput({ privateMode: 'required' }), 'required')

  const allowed = updateAgentPrivacyMode({
    agent,
    privacyMode: 'allowed',
    now: () => '2026-05-09T12:50:00.000Z',
  })
  assert.equal(allowed.ok, true)
  assert.equal(allowed.ok && allowed.changed, true)
  assert.equal(allowed.ok && allowed.agent.policyConfig.privacyMode, 'allowed')
  assert.equal(allowed.ok && allowed.agent.policyConfig.umbra?.mixerRequired, true)
  assert.equal(
    allowed.ok &&
      requiresPrivateSettlement({
        policy: allowed.agent.policyConfig,
      }),
    false,
  )
  assert.equal(
    allowed.ok &&
      requiresPrivateSettlement({
        policy: allowed.agent.policyConfig,
        requestPrivacy: 'required',
      }),
    true,
  )

  const required = updateAgentPrivacyMode({
    agent,
    privacyMode: 'required',
  })
  assert.equal(
    required.ok &&
      requiresPrivateSettlement({
        policy: required.agent.policyConfig,
      }),
    true,
  )

  const disabled = updateAgentPrivacyMode({
    agent: allowed.ok ? allowed.agent : agent,
    privacyMode: 'disabled',
  })
  assert.equal(disabled.ok && disabled.agent.policyConfig.privacyMode, 'disabled')
  assert.equal(disabled.ok && disabled.agent.policyConfig.umbra, undefined)
})

test('dashboard operator registry persists workspace operator records', async () => {
  const operators = new InMemoryDashboardOperatorRegistry()
  await operators.put({
    operatorId: 'operator_test',
    workspaceId: 'workspace_test',
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    displayName: 'Test Operator',
    role: 'owner',
    status: 'active',
    source: 'env',
    lastLoginAt: '2026-05-09T12:00:00.000Z',
  })

  assert.equal((await operators.get('operator_test'))?.role, 'owner')
  assert.equal((await operators.list()).length, 1)

  await operators.remove('operator_test')
  assert.equal(await operators.get('operator_test'), undefined)
})

test('dashboard operator lifecycle normalizes records and status changes', () => {
  const created = createDashboardOperatorRecord({
    env: {
      PALMOS_WORKSPACE_ID: 'workspace_test',
    },
    patch: readDashboardOperatorPatch({
      operatorId: 'Ops Lead!!',
      displayName: 'Ops Lead',
      role: 'owner',
    }),
    now: () => '2026-05-09T12:00:00.000Z',
  })

  assert.deepEqual(created && sanitizeDashboardOperator(created), {
    operatorId: 'ops_lead',
    workspaceId: 'workspace_test',
    displayName: 'Ops Lead',
    role: 'owner',
    status: 'active',
    source: 'env',
    walletAddress: undefined,
    email: undefined,
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    lastLoginAt: undefined,
  })

  const updated = createDashboardOperatorRecord({
    env: {},
    existing: created,
    patch: readDashboardOperatorPatch({
      displayName: 'Ops Viewer',
      role: 'viewer',
    }),
    now: () => '2026-05-09T12:05:00.000Z',
  })
  assert.equal(updated?.operatorId, 'ops_lead')
  assert.equal(updated?.displayName, 'Ops Viewer')
  assert.equal(updated?.role, 'viewer')
  assert.equal(updated?.updatedAt, '2026-05-09T12:05:00.000Z')

  const invalidRole = createDashboardOperatorRecord({
    env: {},
    existing: updated,
    patch: readDashboardOperatorPatch({
      role: 'judge',
    }),
  })
  assert.equal(invalidRole?.role, 'viewer')

  const disabled = setDashboardOperatorStatus({
    operator: updated!,
    status: 'disabled',
    now: () => '2026-05-09T12:10:00.000Z',
  })
  assert.equal(disabled.status, 'disabled')
  assert.equal(disabled.updatedAt, '2026-05-09T12:10:00.000Z')
})

test('dashboard workspace registry persists workspace settings', async () => {
  const workspaces = new InMemoryDashboardWorkspaceRegistry()
  const workspace = await ensureDashboardWorkspaceRecord({
    registry: workspaces,
    env: {
      PALMOS_WORKSPACE_ID: 'workspace_test',
      PALMOS_WORKSPACE_DISPLAY_NAME: 'Test Workspace',
      PALMOS_DEFAULT_SETTLEMENT_MODE: 'ows',
      PALMOS_FRONTEND_ORIGIN: 'https://dashboard.example.com/app',
    },
    now: () => '2026-05-09T12:00:00.000Z',
  })

  assert.deepEqual(workspace, {
    workspaceId: 'workspace_test',
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    displayName: 'Test Workspace',
    status: 'active',
    settings: {
      defaultPolicyTemplateId: undefined,
      defaultApprovalRoute: undefined,
      defaultSettlementMode: 'ows',
      sdkApiBaseUrl: undefined,
      frontendOrigin: 'https://dashboard.example.com',
    },
  })
  assert.equal((await workspaces.get('workspace_test'))?.displayName, 'Test Workspace')
  assert.equal((await workspaces.list()).length, 1)

  const patched = applyDashboardWorkspacePatch({
    workspace,
    patch: readDashboardWorkspacePatch({
      displayName: 'Updated Workspace',
      defaultSettlementMode: 'real-solana',
      sdkApiBaseUrl: 'https://api.example.com/v1',
      frontendOrigin: 'not-a-url',
    }),
    now: () => '2026-05-09T12:05:00.000Z',
  })
  assert.equal(patched.displayName, 'Updated Workspace')
  assert.equal(patched.updatedAt, '2026-05-09T12:05:00.000Z')
  assert.equal(patched.settings.defaultSettlementMode, 'real-solana')
  assert.equal(patched.settings.sdkApiBaseUrl, 'https://api.example.com/v1')
  assert.equal(patched.settings.frontendOrigin, 'https://dashboard.example.com')
})

test('dashboard audit log registry persists operator action records', async () => {
  const audit = new InMemoryDashboardAuditLogRegistry()
  await audit.put({
    auditLogId: 'dashboard_audit_test',
    at: '2026-05-09T12:00:00.000Z',
    workspaceId: 'workspace_test',
    actorId: 'operator:operator_test',
    operatorId: 'operator_test',
    operatorRole: 'operator',
    source: 'env',
    action: 'agent.policy.update',
    status: 'succeeded',
    target: {
      type: 'agent',
      id: 'agent_test',
    },
    summary: 'Updated policy for agent agent_test.',
    metadata: {
      maxPerTransaction: '1',
    },
  })

  assert.equal((await audit.get('dashboard_audit_test'))?.action, 'agent.policy.update')
  assert.equal((await audit.list()).length, 1)

  await audit.remove('dashboard_audit_test')
  assert.equal(await audit.get('dashboard_audit_test'), undefined)
})

test('dashboard audit log registry prunes by retention policy', async () => {
  const audit = new InMemoryDashboardAuditLogRegistry()
  for (const [index, at] of [
    '2026-05-09T12:00:00.000Z',
    '2026-05-08T12:00:00.000Z',
    '2026-01-01T12:00:00.000Z',
  ].entries()) {
    await audit.put({
      auditLogId: `dashboard_audit_${index}`,
      at,
      workspaceId: 'workspace_test',
      actorId: 'operator:operator_test',
      operatorId: 'operator_test',
      operatorRole: 'operator',
      source: 'env',
      action: 'agent.policy.update',
      status: 'succeeded',
      summary: `Audit ${index}`,
    })
  }

  assert.deepEqual(
    await audit.prune({
      maxRecords: 2,
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      now: Date.parse('2026-05-10T12:00:00.000Z'),
    }),
    {
      kept: 2,
      removed: 1,
    },
  )
  assert.deepEqual(
    (await audit.list()).map((record) => record.auditLogId).sort(),
    ['dashboard_audit_0', 'dashboard_audit_1'],
  )
})

test('dashboard admin export redacts secrets and summarizes history', async () => {
  const audit = new InMemoryDashboardAuditLogRegistry([
    {
      auditLogId: 'dashboard_audit_old',
      at: '2026-05-09T11:00:00.000Z',
      workspaceId: 'workspace_test',
      actorId: 'operator:operator_test',
      operatorId: 'operator_test',
      operatorRole: 'owner',
      source: 'env',
      action: 'agent.policy.update',
      status: 'succeeded',
      summary: 'Updated policy.',
      metadata: {
        maxPerTransaction: '1',
        authorization: 'Bearer secret-token',
      },
    },
    {
      auditLogId: 'dashboard_audit_new',
      at: '2026-05-09T12:00:00.000Z',
      workspaceId: 'workspace_test',
      actorId: 'operator:operator_test',
      operatorId: 'operator_test',
      operatorRole: 'owner',
      source: 'env',
      action: 'workspace.export',
      status: 'succeeded',
      summary: 'Exported workspace.',
      metadata: {
        nested: {
          apiKey: 'secret-api-key',
        },
      },
    },
  ])
  const paidCalls = new InMemoryPaidCallRegistry([
    {
      executionId: 'paid_call_failed',
      createdAt: '2026-05-09T11:00:00.000Z',
      updatedAt: '2026-05-09T11:00:00.000Z',
      agentId: 'agent_test',
      serviceId: 'service_test',
      vendorId: 'vendor_test',
      paymentRail: PALMOS_PAYMENT_RAIL,
      amount: '0.25',
      assetSymbol: 'PUSD',
      status: 'failed',
      requestPayload: {
        prompt: 'summarize',
        privateKey: 'private-key-material',
      },
      requestSummary: {},
      responseHeaders: {
        'content-type': 'application/json',
        'set-cookie': 'session=secret',
      },
      responsePreview: {
        token: 'response-token',
      },
    },
    {
      executionId: 'paid_call_executed',
      createdAt: '2026-05-09T12:00:00.000Z',
      updatedAt: '2026-05-09T12:00:00.000Z',
      agentId: 'agent_test',
      serviceId: 'service_test',
      vendorId: 'vendor_test',
      paymentRail: PALMOS_PAYMENT_RAIL,
      amount: '0.1',
      assetSymbol: 'PUSD',
      status: 'executed',
      requestPayload: {},
      requestSummary: {
        apiKey: 'summary-secret',
      },
    },
  ])
  const actionRequests = new InMemoryActionRequestRegistry([
    {
      actionRequestId: 'action_transfer_export',
      createdAt: '2026-05-09T12:05:00.000Z',
      updatedAt: '2026-05-09T12:05:00.000Z',
      agentId: 'agent_test',
      source: 'sdk',
      kind: 'asset.transfer',
      status: 'executed',
      target: {
        kind: 'address',
        address: 'recipient',
        chainId: 'solana-mainnet',
      },
      value: {
        assetSymbol: 'PUSD',
        amount: '0.1',
        chainId: 'solana-mainnet',
      },
      title: 'Transfer 0.1 PUSD',
      summary: 'Requested transfer.',
      requestPayload: {
        note: 'ops',
        apiKey: 'request-secret',
      },
      requestContext: {
        privateKey: 'context-secret',
      },
      policy: {
        approvalRequired: false,
      },
    },
  ])

  const adminExport = await buildDashboardAdminExport({
    env: {
      PALMOS_WORKSPACE_ID: 'workspace_test',
      PALMOS_WORKSPACE_NAME: 'Test Workspace',
    },
    workspace: {
      dashboardWorkspaceRegistry: new InMemoryDashboardWorkspaceRegistry(),
      dashboardAuditLogRegistry: audit,
      paidCallRegistry: paidCalls,
      actionRequestRegistry: actionRequests,
    },
    now: () => '2026-05-09T12:30:00.000Z',
  })

  assert.equal(adminExport.workspace.workspaceId, 'workspace_test')
  assert.equal(adminExport.summary.auditCount, 2)
  assert.equal(adminExport.summary.paidCallCount, 2)
  assert.equal(adminExport.summary.paidCallStatusCounts.executed, 1)
  assert.equal(adminExport.summary.paidCallStatusCounts.failed, 1)
  assert.equal(adminExport.summary.actionRequestCount, 1)
  assert.equal(adminExport.summary.nativeActionRequestCount, 1)
  assert.equal(adminExport.summary.actionRequestKindCounts['asset.transfer'], 1)
  assert.equal(adminExport.summary.actionRequestStatusCounts.executed, 1)
  assert.equal(adminExport.audit[0]?.auditLogId, 'dashboard_audit_new')
  assert.equal(
    (
      adminExport.audit[0]?.metadata?.nested as
        | Record<string, unknown>
        | undefined
    )?.apiKey,
    '[redacted]',
  )
  assert.equal(adminExport.audit[1]?.metadata?.authorization, '[redacted]')
  assert.equal(adminExport.paidCalls[0]?.executionId, 'paid_call_executed')
  assert.equal(adminExport.paidCalls[0]?.requestSummary.apiKey, '[redacted]')
  assert.equal(adminExport.paidCalls[1]?.requestPayload.privateKey, '[redacted]')
  assert.equal(adminExport.paidCalls[1]?.responseHeaders?.['set-cookie'], '[redacted]')
  assert.deepEqual(adminExport.paidCalls[1]?.responsePreview, {
    token: '[redacted]',
  })
  assert.equal(adminExport.actionRequests[0]?.requestPayload.apiKey, '[redacted]')
  assert.equal(
    adminExport.actionRequests[0]?.requestContext?.privateKey,
    '[redacted]',
  )
  assert.equal(
    createDashboardExportFilename({
      workspaceId: 'workspace test',
      exportedAt: adminExport.exportedAt,
    }),
    'palmos-workspace_test-admin-export-2026-05-09T12-30-00-000Z.json',
  )
})

test('PUSD readiness report registry prunes old file records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-readiness-prune-'))
  try {
    const reports = new FilePusdReadinessReportRegistry(dir)
    const baseReport: PusdPaymentReadinessReport = {
      ok: true,
      rpcUrl: 'https://api.mainnet-beta.solana.com',
      payer: 'payer',
      recipient: 'recipient',
      mint: PUSD_MINT,
      amount: '0.01',
      amountBaseUnits: '10000',
      tokenProgramId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      checks: [],
    }

    await reports.put({
      reportId: 'readiness_old',
      createdAt: '2026-01-01T12:00:00.000Z',
      updatedAt: '2026-01-01T12:00:00.000Z',
      ok: true,
      report: baseReport,
    })
    await reports.put({
      reportId: 'readiness_new',
      createdAt: '2026-05-09T12:00:00.000Z',
      updatedAt: '2026-05-09T12:00:00.000Z',
      ok: true,
      report: baseReport,
    })

    assert.deepEqual(
      await reports.prune({
        maxRecords: 10,
        maxAgeMs: 30 * 24 * 60 * 60 * 1000,
        now: Date.parse('2026-05-10T12:00:00.000Z'),
      }),
      {
        kept: 1,
        removed: 1,
      },
    )
    assert.deepEqual(
      (await reports.list()).map((record) => record.reportId),
      ['readiness_new'],
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('atomic JSON file writer leaves a complete readable file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-json-write-'))
  try {
    const filePath = join(dir, 'record.json')
    await writeJsonFile(filePath, {
      ok: true,
      value: 'complete',
    })

    assert.deepEqual(await readJsonFile(filePath), {
      ok: true,
      value: 'complete',
    })
    assert.equal(JSON.parse(await readFile(filePath, 'utf8')).value, 'complete')
    assert.deepEqual(
      (await readdir(dir)).filter((entry) => entry.endsWith('.tmp')),
      [],
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('JSON file reader falls back to the last backup when primary is corrupted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-json-backup-'))
  try {
    const filePath = join(dir, 'record.json')
    await writeJsonFile(filePath, {
      value: 'first',
    })
    await writeJsonFile(filePath, {
      value: 'second',
    })
    await writeFile(filePath, '{bad json', 'utf8')

    assert.deepEqual(await readJsonFile(filePath), {
      value: 'first',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('dashboard storage health scan reports backup-recoverable JSON corruption', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-storage-health-'))
  try {
    const filePath = join(dir, 'record.json')
    await writeJsonFile(filePath, {
      value: 'first',
    })
    await writeJsonFile(filePath, {
      value: 'second',
    })
    await writeFile(filePath, '{bad json', 'utf8')
    await writeFile(join(dir, 'orphan.tmp'), 'partial', 'utf8')

    assert.deepEqual(await scanDashboardJsonHealth(dir), {
      jsonFiles: 1,
      backupFiles: 1,
      tempFiles: 1,
      corruptedPrimaryFiles: ['record.json'],
      backupRecoveredFiles: ['record.json'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('dashboard storage backup archives workspace files and skips temp files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-storage-backup-'))
  try {
    await mkdir(join(dir, 'agents'), { recursive: true })
    await writeJsonFile(join(dir, 'agents', 'agent_test.json'), {
      agentId: 'agent_test',
    })
    await writeFile(join(dir, 'partial.tmp'), 'do not archive', 'utf8')

    const backup = await createDashboardStorageBackup(
      {
        baseDir: dir,
      } as never,
      {
        now: new Date('2026-05-09T12:00:00.000Z'),
      },
    )
    const archive = gunzipSync(await readFile(backup.archivePath)).toString(
      'utf8',
    )

    assert.equal(backup.entryCount, 1)
    assert.match(backup.archivePath, /palmos-workspace-2026-05-09T12-00-00-000Z\.tar\.gz$/)
    assert.match(archive, /agents\/agent_test\.json/)
    assert.match(archive, /agent_test/)
    assert.doesNotMatch(archive, /partial\.tmp/)

    const inspection = await inspectDashboardStorageBackup({
      archivePath: backup.archivePath,
      targetBaseDir: join(dir, 'restore-target'),
    })
    assert.equal(inspection.ok, true)
    assert.equal(inspection.entryCount, 1)
    assert.deepEqual(inspection.issues, [])
    assert.equal(inspection.entries[0]?.archivePath, 'agents/agent_test.json')
    assert.match(
      inspection.entries[0]?.targetPath ?? '',
      /restore-target\/agents\/agent_test\.json$/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

function createTestTarHeader(input: {
  path: string
  size: number
  typeFlag?: string
}): Buffer {
  const header = Buffer.alloc(512)
  header.write(input.path, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(`${input.size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii')
  header.fill(' ', 148, 156)
  header.write(input.typeFlag ?? '0', 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')

  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return header
}

test('dashboard storage restore dry run rejects unsafe archive paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-restore-dry-run-'))
  try {
    const payload = Buffer.from('bad', 'utf8')
    const padding = Buffer.alloc(512 - payload.length)
    const tar = Buffer.concat([
      createTestTarHeader({
        path: '../escape.json',
        size: payload.length,
      }),
      payload,
      padding,
      Buffer.alloc(512),
      Buffer.alloc(512),
    ])
    const archivePath = join(dir, 'unsafe.tar.gz')
    await writeFile(archivePath, gzipSync(tar))

    const inspection = await inspectDashboardStorageBackup({
      archivePath,
      targetBaseDir: join(dir, 'restore-target'),
    })
    assert.equal(inspection.ok, false)
    assert.deepEqual(inspection.entries.map((entry) => entry.archivePath), [
      '../escape.json',
    ])
    assert.match(inspection.issues.join('\n'), /Unsafe archive path/)
    assert.match(
      inspection.issues.join('\n'),
      /escapes target base directory/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('dashboard storage restore writes validated archive entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-storage-restore-'))
  try {
    await mkdir(join(dir, 'source', 'agents'), { recursive: true })
    await writeJsonFile(join(dir, 'source', 'agents', 'agent_test.json'), {
      agentId: 'agent_test',
      displayName: 'Restore Test Agent',
    })

    const backup = await createDashboardStorageBackup({
      baseDir: join(dir, 'source'),
    } as never)
    const targetBaseDir = join(dir, 'restore-target')
    const result = await restoreDashboardStorageBackup({
      archivePath: backup.archivePath,
      targetBaseDir,
      confirm: true,
    })

    assert.equal(result.ok, true)
    assert.equal(result.restoredCount, 1)
    assert.deepEqual(
      await readJsonFile(join(targetBaseDir, 'agents', 'agent_test.json')),
      {
        agentId: 'agent_test',
        displayName: 'Restore Test Agent',
      },
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('dashboard storage restore refuses accidental overwrites', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-storage-restore-conflict-'))
  try {
    await mkdir(join(dir, 'source', 'agents'), { recursive: true })
    await writeJsonFile(join(dir, 'source', 'agents', 'agent_test.json'), {
      agentId: 'agent_test',
      displayName: 'From Backup',
    })

    const backup = await createDashboardStorageBackup({
      baseDir: join(dir, 'source'),
    } as never)
    const targetBaseDir = join(dir, 'restore-target')
    await mkdir(join(targetBaseDir, 'agents'), { recursive: true })
    await writeJsonFile(join(targetBaseDir, 'agents', 'agent_test.json'), {
      agentId: 'agent_test',
      displayName: 'Existing',
    })

    const refused = await restoreDashboardStorageBackup({
      archivePath: backup.archivePath,
      targetBaseDir,
      confirm: true,
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.restoredCount, 0)
    assert.match(refused.issues.join('\n'), /already exists/)
    assert.deepEqual(
      await readJsonFile(join(targetBaseDir, 'agents', 'agent_test.json')),
      {
        agentId: 'agent_test',
        displayName: 'Existing',
      },
    )

    const overwritten = await restoreDashboardStorageBackup({
      archivePath: backup.archivePath,
      targetBaseDir,
      confirm: true,
      overwriteExisting: true,
    })
    assert.equal(overwritten.ok, true)
    assert.equal(overwritten.restoredCount, 1)
    assert.deepEqual(
      await readJsonFile(join(targetBaseDir, 'agents', 'agent_test.json')),
      {
        agentId: 'agent_test',
        displayName: 'From Backup',
      },
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('dashboard role guard protects mutating routes by operator role', () => {
  // Viewer session is denied a mutating operation.
  const viewerContext = {
    env: {
      PALMOS_PUBLIC_ACCESS_MODE: '1',
      PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
    },
  } as never
  const viewerResponse = createTestResponse()

  assert.equal(
    requireDashboardRole({
      req: createCookieRequest(operatorSessionCookie({ role: 'viewer' })),
      res: viewerResponse as never,
      context: viewerContext,
      operation: 'agent.create',
    }),
    undefined,
  )
  assert.equal(viewerResponse.statusCode, 403)
  assert.deepEqual(viewerResponse.body, {
    ok: false,
    error: 'dashboard_role_required',
    message: 'Dashboard role does not allow this operation.',
    details: {
      requiredRoles: ['owner', 'operator'],
      role: 'viewer',
      operation: 'agent.create',
    },
  })

  // Local-dev bypass (non-public mode) resolves the env operator.
  const localResponse = createTestResponse()
  assert.equal(
    requireDashboardRole({
      req: createCookieRequest(''),
      res: localResponse as never,
      context: {
        env: {
          PALMOS_OPERATOR_ROLE: 'operator',
        },
      } as never,
    })?.role,
    'operator',
  )
  assert.equal(localResponse.statusCode, 200)

  // An owner session is allowed the mutating operation.
  const ownerResponse = createTestResponse()
  assert.equal(
    requireDashboardRole({
      req: createCookieRequest(operatorSessionCookie({ role: 'owner' })),
      res: ownerResponse as never,
      context: {
        env: {
          PALMOS_PUBLIC_ACCESS_MODE: '1',
          PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
        },
      } as never,
      operation: 'service.register',
    })?.role,
    'owner',
  )
  assert.equal(ownerResponse.statusCode, 200)
})

test('creates deterministic PUSD payment instructions and validates policy binding', () => {
  const request = createPusdPaymentRequest({
    amount: '0.01',
    recipient: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
    description: 'Test payment',
    serviceId: 'local.pusd.spot_price',
    vendorId: 'local_pusd_demo',
    ttlSeconds: 60,
    now: () => new Date('2026-05-09T12:00:00.000Z'),
    createId: () => 'pusd_pay_req_test',
    env: {
      PUSD_SOLANA_NETWORK: 'mainnet-beta',
      PUSD_MINT,
    },
  })
  const payment = toPusdPaymentRequiredResponse(request)

  assert.equal(payment.amount, '0.01')
  assert.equal(payment.reference, 'pusd_pay_req_test')
  assert.equal(payment.expiresAt, '2026-05-09T12:01:00.000Z')
  assert.equal(payment.mint, PUSD_MINT)
  assert.deepEqual(
    validatePusdPaymentInstruction(payment, {
      amount: '0.010000',
      recipient: request.recipient,
      mint: PUSD_MINT,
      network: 'solana-mainnet',
    }),
    [],
  )
  assert.throws(
    () =>
      assertPusdPaymentInstructionMatchesPolicy(payment, {
        amount: '0.02',
        recipient: request.recipient,
      }),
    /amount_mismatch/,
  )
})

test('formats readiness failures with concrete failing checks', () => {
  const report: PusdPaymentReadinessReport = {
    ok: false,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    payer: 'payer',
    recipient: 'recipient',
    mint: PUSD_MINT,
    amount: '0.01',
    amountBaseUnits: '10000',
    tokenProgramId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    payerTokenAccount: 'payerAta',
    recipientTokenAccount: 'recipientAta',
    checks: [
      {
        checkId: 'pusd.payer.sol_balance',
        status: 'failed',
        summary: 'Payer does not have enough SOL for transaction fees.',
      },
      {
        checkId: 'pusd.recipient.ata_exists',
        status: 'warning',
        summary: 'Recipient ATA will be created.',
      },
    ],
  }

  assert.equal(
    formatPusdReadinessFailure(report),
    'pusd.payer.sol_balance: Payer does not have enough SOL for transaction fees.',
  )
})

test('PalmosClient obeys explicit local and real Solana settlement modes', async () => {
  const request = createPusdPaymentRequest({
    amount: '0.01',
    recipient: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
    serviceId: 'local.pusd.spot_price',
    vendorId: 'local_pusd_demo',
    now: () => new Date('2026-05-09T12:00:00.000Z'),
    createId: () => 'pusd_pay_req_mode_test',
    env: {
      PUSD_SOLANA_NETWORK: 'mainnet-beta',
      PUSD_MINT,
    },
  })
  const payment = toPusdPaymentRequiredResponse(request)
  const service: PalmosPaidServiceDefinition<Record<string, unknown>> = {
    serviceId: 'local.pusd.spot_price',
    label: 'Spot price',
    vendorId: 'local_pusd_demo',
    chainId: 'solana-mainnet',
    assetSymbol: 'PUSD',
    expectedAmount: '0.01',
    paymentRail: PALMOS_PAYMENT_RAIL,
    buildRequest: () => ({
      url: 'http://127.0.0.1:4021/spot-price',
      init: { method: 'POST' },
      requestSummary: {},
    }),
  }

  const localCalls: RequestInit[] = []
  const localClient = new PalmosClient(
    {
      allowLocalDemoPayments: true,
      keypair: {
        privateKey: 'not-a-solana-private-key',
      },
    },
    async (_url, init) => {
      localCalls.push(init ?? {})
      if (localCalls.length === 1) {
        return new Response(JSON.stringify(payment), {
          status: 402,
          headers: { 'content-type': 'application/json' },
        })
      }

      const headers = new Headers(init?.headers)
      assert.equal(headers.get('x-palmos-demo-payment'), '1')
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  )

  const localResult = await localClient.execute(
    service,
    {},
    { settlementMode: 'local-demo' },
  )
  assert.equal(localResult.status, 200)
  assert.equal(localCalls.length, 2)

  const realClient = new PalmosClient(
    {
      allowLocalDemoPayments: true,
    },
    async () =>
      new Response(JSON.stringify(payment), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      }),
  )

  await assert.rejects(
    () => realClient.execute(service, {}, { settlementMode: 'real-solana' }),
    /Real Solana PUSD settlement requires/,
  )
})

test('Solana keypair env reader accepts OWS wallet fallback', async () => {
  const keypair = Keypair.generate()
  const loaded = await readSolanaKeypairFromEnv({
    OWS_WALLET_PRIVATE_KEY: JSON.stringify([...keypair.secretKey]),
  })

  assert.equal(loaded?.publicKey.toBase58(), keypair.publicKey.toBase58())
})

test('new agent demo defaults allow approval instead of hard block', () => {
  const policy: AgentPolicyTemplateInput = {
    agentId: 'demo_agent',
    organizationId: 'org_demo',
    environment: 'production',
    walletType: 'ops',
    allowedChains: ['solana-mainnet'],
    allowedAssets: ['PUSD'],
    allowedSignerClasses: ['multisig'],
    allowedVendors: [
      {
        vendorId: 'ops_research_vendor',
        label: 'PUSD Ops Research Vendor',
        destinationAddress: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
        chainId: 'solana-mainnet',
      },
    ],
    autoApproveUnder: '0.05',
    maxPerTransaction: '2.00',
    sessionBudget: '2.00',
    heartbeatTimeoutSeconds: 900,
  }

  assert.deepEqual(
    evaluateSpendRequest({
      policy,
      amount: '0.25',
      vendorId: 'ops_research_vendor',
      trustTier: 'new',
    }),
    {
      status: 'restricted',
      requiresApproval: true,
      effectiveMaxPerTransaction: '0.50',
      reasonCode: 'policy.approval_required',
    },
  )
})

function createTestAgent(input?: {
  sessionBudget?: string
  maxPerTransaction?: string
  autoApproveUnder?: string
  settlementMode?: AgentRecord['settlementMode']
  walletBackend?: AgentRecord['walletBackend']
  owsWalletName?: string
}): AgentRecord {
  const policyConfig: AgentPolicyTemplateInput = {
    agentId: 'budget_agent',
    organizationId: 'org_demo',
    environment: 'production',
    walletType: 'ops',
    allowedChains: ['solana-mainnet'],
    allowedAssets: ['PUSD'],
    allowedSignerClasses: ['multisig'],
    allowedVendors: [
      {
        vendorId: 'local_pusd_demo',
        label: 'PUSD Demo Vendor',
        destinationAddress: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
        chainId: 'solana-mainnet',
      },
    ],
    autoApproveUnder: input?.autoApproveUnder ?? '0.5',
    maxPerTransaction: input?.maxPerTransaction ?? '1',
    sessionBudget: input?.sessionBudget ?? '1',
    heartbeatTimeoutSeconds: 900,
  }

  return {
    agentId: 'budget_agent',
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    displayName: 'Budget Agent',
    organizationId: 'org_demo',
    environment: 'production',
    actorId: 'agent:budget_agent',
    sessionId: 'session_budget_agent',
    walletType: 'ops',
    settlementMode: input?.settlementMode ?? 'local-demo',
    walletId: 'wallet_budget_agent',
    walletState: 'active_limited',
    walletBackend: input?.walletBackend,
    owsWalletName: input?.owsWalletName,
    policyConfig,
    trustTier: 'healthy',
    status: 'ready',
    lastCheckInAt: '2026-05-09T12:00:00.000Z',
  }
}

const budgetService: PalmosPaidServiceDefinition<Record<string, unknown>> = {
  serviceId: 'local.pusd.spot_price',
  label: 'Spot price',
  vendorId: 'local_pusd_demo',
  chainId: 'solana-mainnet',
  assetSymbol: 'PUSD',
  expectedAmount: '0.01',
  paymentRail: PALMOS_PAYMENT_RAIL,
  buildRequest: () => ({
    url: 'http://127.0.0.1:4021/spot-price',
    init: { method: 'POST' },
    requestSummary: {},
  }),
}

const unallowedService: PalmosPaidServiceDefinition<Record<string, unknown>> = {
  serviceId: 'custom.pusd.unallowed',
  label: 'Unallowed service',
  vendorId: 'unallowed_vendor',
  chainId: 'solana-mainnet',
  assetSymbol: 'PUSD',
  expectedAmount: '0.01',
  paymentRail: PALMOS_PAYMENT_RAIL,
  buildRequest: () => ({
    url: 'https://payments.example.com/unallowed',
    init: { method: 'GET' },
    requestSummary: {},
  }),
}

const fakeKernel = {
  async loadOrCreateSession(input: { sessionId: string }) {
    return { sessionId: input.sessionId }
  },
  async handleInput(input: { sessionId: string }) {
    return {
      session: { sessionId: input.sessionId },
      run: {
        runId: 'run_budget_test',
        status: 'completed',
        currentPhase: 'completed',
        signatureRequestRefs: [],
      },
      output: [],
    }
  },
  async ingestCallback() {},
}

const approvalPendingKernel = {
  async loadOrCreateSession(input: { sessionId: string }) {
    return { sessionId: input.sessionId }
  },
  async handleInput(input: {
    sessionId: string
    kind?: string
    requestedActionType?: string
  }) {
    return {
      session: { sessionId: input.sessionId },
      run: {
        runId: 'run_approval_pending_test',
        status: 'waiting_for_approval',
        currentPhase: 'awaiting_approval',
        approvalStateRef: 'approval_state_test',
        signatureRequestRefs: [],
      },
      output: ['Approval required.'],
    }
  },
  async ingestCallback() {},
}

const fakePalmosClient = {
  async execute() {
    return {
      status: 200,
      headers: {},
      body: {
        ok: true,
      },
    }
  },
}

function createApprovalResumeKernel() {
  let approved = false
  const buildRun = () => ({
    runId: 'run_approval_resume_test',
    status: approved ? 'completed' : 'waiting_for_approval',
    currentPhase: approved ? 'completed' : 'awaiting_approval',
    approvalStateRef: 'approval_state_resume_test',
    signatureRequestRefs: [],
  })

  return {
    async loadOrCreateSession(input: { sessionId: string }) {
      return { sessionId: input.sessionId }
    },
    async handleInput(input: { sessionId: string }) {
      return {
        session: { sessionId: input.sessionId },
        run: buildRun(),
        output: approved ? ['Approved.'] : ['Approval required.'],
      }
    },
    async ingestCallback(input: { status: string }) {
      if (input.status === 'approved') {
        approved = true
      }
    },
  }
}

test('policy rejects invalid PUSD payment amounts instead of treating them as zero', () => {
  const agent = createTestAgent()

  assert.deepEqual(
    evaluateSpendRequest({
      policy: agent.policyConfig,
      amount: 'not-a-number',
      vendorId: 'local_pusd_demo',
      trustTier: 'healthy',
    }),
    {
      status: 'denied',
      requiresApproval: false,
      effectiveMaxPerTransaction: '1.00',
      reasonCode: 'policy.invalid_amount',
    },
  )
})

test('agent credentials authenticate persisted agents and reject revoked keys', async () => {
  const agent = createTestAgent()
  const agentRegistry = new InMemoryAgentRegistry([agent])
  const credentials = new InMemoryAgentCredentialRegistry()
  const created = await createAgentCredential(
    {
      credentials,
      now: () => '2026-05-09T12:00:00.000Z',
      createId: () => 'agent_key_test',
    },
    {
      agentId: agent.agentId,
      label: 'Test SDK key',
    },
  )

  const authenticated = await authenticateAgentCredential(
    {
      credentials,
      agentRegistry,
      now: () => '2026-05-09T12:01:00.000Z',
    },
    created.token,
  )

  assert.equal(authenticated?.agent.agentId, agent.agentId)
  assert.equal(authenticated?.credential.credentialId, 'agent_key_test')
  assert.equal(
    (await credentials.get('agent_key_test'))?.lastUsedAt,
    '2026-05-09T12:01:00.000Z',
  )

  await credentials.put({
    ...(await credentials.get('agent_key_test'))!,
    status: 'revoked',
  })

  assert.equal(
    await authenticateAgentCredential(
      {
        credentials,
        agentRegistry,
      },
      created.token,
    ),
    undefined,
  )
})

test('agent credential auth does not reactivate a key revoked during last-used update', async () => {
  const agent = createTestAgent()
  const agentRegistry = new InMemoryAgentRegistry([agent])
  const credentials = new InMemoryAgentCredentialRegistry()
  const created = await createAgentCredential(
    {
      credentials,
      now: () => '2026-05-09T12:00:00.000Z',
      createId: () => 'agent_key_auth_race',
    },
    {
      agentId: agent.agentId,
      label: 'Race key',
    },
  )

  const authenticated = await authenticateAgentCredential(
    {
      agentRegistry,
      credentials: {
        get: (credentialId) => credentials.get(credentialId),
        put: (record) => credentials.put(record),
        list: () => credentials.list(),
        listByAgent: (agentId) => credentials.listByAgent(agentId),
        remove: (credentialId) => credentials.remove(credentialId),
        putIfStatus: async () => {
          await credentials.put({
            ...(await credentials.get('agent_key_auth_race'))!,
            status: 'revoked',
            updatedAt: '2026-05-09T12:00:30.000Z',
          })
          return false
        },
      },
      now: () => '2026-05-09T12:01:00.000Z',
    },
    created.token,
  )

  assert.equal(authenticated, undefined)
  const credential = await credentials.get('agent_key_auth_race')
  assert.equal(credential?.status, 'revoked')
  assert.equal(credential?.lastUsedAt, undefined)
})

test('paid call executes allowed service through the governed workflow', async () => {
  const agent = createTestAgent()
  const paidCalls = new InMemoryPaidCallRegistry()
  const result = await executePaidServiceCall(
    {
      kernel: fakeKernel as never,
      agentRegistry: new InMemoryAgentRegistry([agent]),
      paidCalls,
      palmosClient: fakePalmosClient as never,
      serviceCatalog: {
        [budgetService.serviceId]: budgetService,
      },
      createId: () => 'paid_call_allowed_workflow',
      now: () => '2026-05-09T12:00:00.000Z',
      env: {},
    },
    {
      agentId: agent.agentId,
      serviceId: budgetService.serviceId,
      request: {},
      amount: '0.01',
    },
  )

  assert.equal(result.kind, 'executed')
  assert.equal(result.execution.status, 'executed')
  assert.equal(result.execution.executionId, 'paid_call_allowed_workflow')
  assert.equal(result.execution.settlement?.rail, PALMOS_PAYMENT_RAIL)
  assert.equal(result.execution.settlement?.source, 'local-demo')
  assert.equal(
    result.execution.settlement?.recipient,
    agent.policyConfig.allowedVendors[0]?.destinationAddress,
  )
  assert.equal(result.execution.settlement?.confirmationStatus, 'not_applicable')
  assert.equal((await paidCalls.get('paid_call_allowed_workflow'))?.status, 'executed')
})

test('paid call records blocked result for disallowed vendors', async () => {
  const agent = createTestAgent()
  const paidCalls = new InMemoryPaidCallRegistry()
  const result = await executePaidServiceCall(
    {
      kernel: fakeKernel as never,
      agentRegistry: new InMemoryAgentRegistry([agent]),
      paidCalls,
      palmosClient: fakePalmosClient as never,
      serviceCatalog: {
        [unallowedService.serviceId]: unallowedService,
      },
      createId: () => 'paid_call_blocked_vendor',
      now: () => '2026-05-09T12:00:00.000Z',
    },
    {
      agentId: agent.agentId,
      serviceId: unallowedService.serviceId,
      request: {},
      amount: '0.01',
    },
  )

  assert.equal(result.kind, 'blocked')
  assert.equal(result.execution.status, 'blocked')
  assert.equal(result.execution.errorCode, 'policy.blocked')
  assert.equal((await paidCalls.get('paid_call_blocked_vendor'))?.status, 'blocked')
})

test('paid call creates ActionRequest intake before compatibility PaidCall write', async () => {
  const agent = createTestAgent()
  const actionRequests = new InMemoryActionRequestRegistry()
  const paidCalls = new InMemoryPaidCallRegistry([], actionRequests)
  let intakeRecordBeforePaidCall: Awaited<
    ReturnType<InMemoryActionRequestRegistry['get']>
  >
  const originalPut = paidCalls.put.bind(paidCalls)
  ;(paidCalls as typeof paidCalls & {
    put: typeof paidCalls.put
  }).put = async (record) => {
    intakeRecordBeforePaidCall = await actionRequests.get(record.executionId)
    await originalPut(record)
  }

  const result = await executePaidServiceCall(
    {
      kernel: fakeKernel as never,
      agentRegistry: new InMemoryAgentRegistry([agent]),
      actionRequests,
      paidCalls,
      palmosClient: fakePalmosClient as never,
      serviceCatalog: {
        [unallowedService.serviceId]: unallowedService,
      },
      createId: () => 'paid_call_action_request_first',
      now: () => '2026-05-09T12:00:00.000Z',
    },
    {
      agentId: agent.agentId,
      serviceId: unallowedService.serviceId,
      request: {},
      amount: '0.01',
      source: 'sdk',
    },
  )

  assert.equal(result.kind, 'blocked')
  assert.equal(intakeRecordBeforePaidCall?.actionRequestId, 'paid_call_action_request_first')
  assert.equal(intakeRecordBeforePaidCall?.status, 'created')
  assert.equal(intakeRecordBeforePaidCall?.source, 'sdk')
  assert.equal(
    (await actionRequests.get('paid_call_action_request_first'))?.status,
    'blocked',
  )
})

test('paid call above approval threshold records approval-pending execution', async () => {
  const agent = createTestAgent({
    autoApproveUnder: '0.05',
    maxPerTransaction: '1',
    sessionBudget: '1',
  })
  const paidCalls = new InMemoryPaidCallRegistry()
  const result = await executePaidServiceCall(
    {
      kernel: approvalPendingKernel as never,
      agentRegistry: new InMemoryAgentRegistry([agent]),
      paidCalls,
      palmosClient: fakePalmosClient as never,
      serviceCatalog: {
        [budgetService.serviceId]: budgetService,
      },
      createId: () => 'paid_call_approval_workflow',
      now: () => '2026-05-09T12:00:00.000Z',
      env: {},
    },
    {
      agentId: agent.agentId,
      serviceId: budgetService.serviceId,
      request: {},
      amount: '0.25',
    },
  )

  assert.equal(result.kind, 'approval_pending')
  assert.equal(result.execution.status, 'approval_pending')
  assert.equal(result.execution.runId, 'run_approval_pending_test')
  assert.equal(
    (await paidCalls.get('paid_call_approval_workflow'))?.status,
    'approval_pending',
  )
})

test('approval decision resumes and executes the same paid-call record', async () => {
  const agent = createTestAgent({
    autoApproveUnder: '0.05',
    maxPerTransaction: '1',
    sessionBudget: '1',
  })
  const agentRegistry = new InMemoryAgentRegistry([agent])
  const paidCalls = new InMemoryPaidCallRegistry()
  const kernel = createApprovalResumeKernel()

  const pending = await executePaidServiceCall(
    {
      kernel: kernel as never,
      agentRegistry,
      paidCalls,
      palmosClient: fakePalmosClient as never,
      serviceCatalog: {
        [budgetService.serviceId]: budgetService,
      },
      createId: () => 'paid_call_approval_resume',
      now: () => '2026-05-09T12:00:00.000Z',
      env: {},
    },
    {
      agentId: agent.agentId,
      serviceId: budgetService.serviceId,
      request: {},
      amount: '0.25',
    },
  )

  assert.equal(pending.kind, 'approval_pending')
  assert.equal(
    (await paidCalls.get('paid_call_approval_resume'))?.status,
    'approval_pending',
  )

  const approved = await resolvePendingPaidCallApproval(
    {
      kernel: kernel as never,
      agentRegistry,
      paidCalls,
      palmosClient: fakePalmosClient as never,
      serviceCatalog: {
        [budgetService.serviceId]: budgetService,
      },
      now: () => '2026-05-09T12:01:00.000Z',
      env: {},
    },
    {
      executionId: 'paid_call_approval_resume',
      decision: 'approved',
      approverActorId: 'manager_dashboard',
      approverRole: 'manager',
      decidedAt: '2026-05-09T12:01:00.000Z',
    },
  )

  assert.equal(approved.kind, 'executed')
  assert.equal(approved.execution.executionId, 'paid_call_approval_resume')
  assert.equal(approved.execution.status, 'executed')
  assert.equal((await paidCalls.get('paid_call_approval_resume'))?.status, 'executed')
  assert.equal((await agentRegistry.get(agent.agentId))?.status, 'ready')
})

test('concurrent approval decisions claim a paid call only once', async () => {
  const agent = createTestAgent({
    autoApproveUnder: '0.05',
    maxPerTransaction: '1',
    sessionBudget: '1',
  })
  const agentRegistry = new InMemoryAgentRegistry([agent])
  const paidCalls = new InMemoryPaidCallRegistry()
  const kernel = createApprovalResumeKernel()
  let executeCount = 0
  const countedPalmosClient = {
    async execute() {
      executeCount += 1
      return {
        status: 200,
        headers: {},
        body: {
          ok: true,
        },
      }
    },
  }

  await executePaidServiceCall(
    {
      kernel: kernel as never,
      agentRegistry,
      paidCalls,
      palmosClient: countedPalmosClient as never,
      serviceCatalog: {
        [budgetService.serviceId]: budgetService,
      },
      createId: () => 'paid_call_concurrent_approval',
      now: () => '2026-05-09T12:00:00.000Z',
      env: {},
    },
    {
      agentId: agent.agentId,
      serviceId: budgetService.serviceId,
      request: {},
      amount: '0.25',
    },
  )

  const deps = {
    kernel: kernel as never,
    agentRegistry,
    paidCalls,
    palmosClient: countedPalmosClient as never,
    serviceCatalog: {
      [budgetService.serviceId]: budgetService,
    },
    now: () => '2026-05-09T12:01:00.000Z',
    env: {},
  }
  const input = {
    executionId: 'paid_call_concurrent_approval',
    decision: 'approved' as const,
    approverActorId: 'manager_dashboard',
    approverRole: 'manager',
    decidedAt: '2026-05-09T12:01:00.000Z',
  }

  const results = await Promise.allSettled([
    resolvePendingPaidCallApproval(deps, input),
    resolvePendingPaidCallApproval(deps, input),
  ])

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  assert.equal(executeCount, 1)
  assert.equal(
    (await paidCalls.get('paid_call_concurrent_approval'))?.status,
    'executed',
  )
})

test('approval endpoint audits duplicate decisions as conflicts', async () => {
  const now = Date.now()
  const operatorToken = operatorSessionToken({ role: 'operator', expiresAt: now + 60_000 })
  const audit = new InMemoryDashboardAuditLogRegistry()
  const app = express()
  app.use(express.json())
  registerSystemRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      baseDir: '/tmp/palmos-approval-conflict-test',
      workspace: {
        dashboardAuditLogRegistry: audit,
        paidCallRegistry: {
          get: async () => ({
            executionId: 'paid_call_conflict',
            createdAt: '2026-05-09T12:00:00.000Z',
            updatedAt: '2026-05-09T12:01:00.000Z',
            agentId: 'agent_test',
            serviceId: 'service_test',
            vendorId: 'vendor_test',
            paymentRail: PALMOS_PAYMENT_RAIL,
            amount: '0.25',
            assetSymbol: 'PUSD',
            status: 'waiting_for_execution',
            runId: 'run_conflict',
            requestPayload: {},
            requestSummary: {},
          }),
        },
      },
      buildPalmosServiceCatalog: async () => ({
        [budgetService.serviceId]: budgetService,
      }),
      buildDashboardSnapshot: async () => ({
        summary: {},
      }),
    } as never,
  )
  const response = await invokeRoute({
    app,
    path: '/api/dashboard/approvals/:executionId/:decision',
    method: 'post',
    headers: {
      'content-type': 'application/json',
      cookie: `palmos_operator_session=${encodeURIComponent(operatorToken)}`,
    },
    params: {
      executionId: 'paid_call_conflict',
      decision: 'approve',
    },
    body: {},
  })
  const body = response.body as {
    error: string
    details: {
      currentStatus: string
    }
  }

  assert.equal(response.statusCode, 409, JSON.stringify(body))
  assert.equal(body.error, 'approval_conflict')
  assert.equal(body.details.currentStatus, 'waiting_for_execution')

  const auditRecords = await audit.list()
  assert.equal(auditRecords.length, 1)
  assert.equal(auditRecords[0]?.action, 'approval.decide')
  assert.equal(auditRecords[0]?.status, 'failed')
  assert.equal(auditRecords[0]?.metadata?.errorCode, 'approval_conflict')
})

test('credential rotate endpoint audits stale credential claims as conflicts', async () => {
  const now = Date.now()
  const operatorToken = operatorSessionToken({ role: 'operator', expiresAt: now + 60_000 })
  const audit = new InMemoryDashboardAuditLogRegistry()
  const agent = createTestAgent()
  const activeCredential = {
    credentialId: 'credential_rotate_race',
    agentId: agent.agentId,
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    label: 'Race key',
    keyPrefix: 'palmos_race',
    keyHash: 'hash_race',
    status: 'active' as const,
  }
  const revokedCredential = {
    ...activeCredential,
    status: 'revoked' as const,
    updatedAt: '2026-05-09T12:01:00.000Z',
  }
  let reads = 0
  const app = express()
  app.use(express.json())
  registerAgentRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      baseDir: '/tmp/palmos-credential-conflict-test',
      workspace: {
        agentRegistry: new InMemoryAgentRegistry([agent]),
        agentCredentialRegistry: {
          get: async () => {
            reads += 1
            return reads === 1 ? activeCredential : revokedCredential
          },
          put: async () => undefined,
          putIfStatus: async () => false,
          list: async () => [revokedCredential],
          listByAgent: async () => [revokedCredential],
          remove: async () => undefined,
        },
        dashboardAuditLogRegistry: audit,
      },
      buildPalmosServiceCatalog: async () => ({}),
      buildDashboardSnapshot: async () => ({
        summary: {},
      }),
    } as never,
  )
  const response = await invokeRoute({
    app,
    path: '/api/dashboard/agent-credentials/:credentialId/rotate',
    method: 'post',
    headers: {
      'content-type': 'application/json',
      cookie: `palmos_operator_session=${encodeURIComponent(operatorToken)}`,
    },
    params: {
      credentialId: 'credential_rotate_race',
    },
    body: {
      label: 'Rotated race key',
    },
  })
  const body = response.body as {
    error: string
    details: {
      currentStatus: string
    }
  }

  assert.equal(response.statusCode, 409, JSON.stringify(body))
  assert.equal(body.error, 'credential_conflict')
  assert.equal(body.details.currentStatus, 'revoked')

  const auditRecords = await audit.list()
  assert.equal(auditRecords.length, 1)
  assert.equal(auditRecords[0]?.action, 'agent_credential.rotate')
  assert.equal(auditRecords[0]?.status, 'failed')
  assert.equal(auditRecords[0]?.metadata?.errorCode, 'credential_conflict')
})

test('credential rotate endpoint replays duplicate idempotent requests', async () => {
  const now = Date.now()
  const operatorToken = operatorSessionToken({ role: 'operator', expiresAt: now + 60_000 })
  const audit = new InMemoryDashboardAuditLogRegistry()
  const agent = createTestAgent()
  const credentials = new InMemoryAgentCredentialRegistry([
    {
      credentialId: 'credential_rotate_idempotent',
      agentId: agent.agentId,
      createdAt: '2026-05-09T12:00:00.000Z',
      updatedAt: '2026-05-09T12:00:00.000Z',
      label: 'Retry key',
      keyPrefix: 'palmos_retry',
      keyHash: 'hash_retry',
      status: 'active',
    },
  ])
  const app = express()
  app.use(express.json())
  registerAgentRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      baseDir: '/tmp/palmos-credential-idempotency-test',
      mutationIdempotency: createDashboardMutationIdempotencyStore(),
      workspace: {
        agentRegistry: new InMemoryAgentRegistry([agent]),
        agentCredentialRegistry: credentials,
        dashboardAuditLogRegistry: audit,
      },
      buildPalmosServiceCatalog: async () => ({}),
      buildDashboardSnapshot: async () => ({
        summary: {},
      }),
    } as never,
  )

  const request = {
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'rotate-retry-123',
      cookie: `palmos_operator_session=${encodeURIComponent(operatorToken)}`,
    },
    params: {
      credentialId: 'credential_rotate_idempotent',
    },
    body: {
      label: 'Rotated retry key',
    },
  }
  const first = await invokeRoute({
    app,
    path: '/api/dashboard/agent-credentials/:credentialId/rotate',
    method: 'post',
    ...request,
  })
  const firstBody = first.body
  const second = await invokeRoute({
    app,
    path: '/api/dashboard/agent-credentials/:credentialId/rotate',
    method: 'post',
    ...request,
  })
  const secondBody = second.body

  assert.equal(first.statusCode, 200, JSON.stringify(firstBody))
  assert.equal(second.statusCode, 200, JSON.stringify(secondBody))
  assert.equal(second.getHeader('idempotency-replayed'), 'true')
  assert.deepEqual(secondBody, firstBody)

  const auditRecords = await audit.list()
  assert.equal(auditRecords.length, 1)
  assert.equal(auditRecords[0]?.action, 'agent_credential.rotate')

  const records = await credentials.listByAgent(agent.agentId)
  assert.equal(records.length, 2)
  assert.equal(
    records.filter((record) => record.status === 'active').length,
    1,
  )
})

test('agent policy endpoint audits stale agent updates as conflicts', async () => {
  const now = Date.now()
  const operatorToken = operatorSessionToken({ role: 'operator', expiresAt: now + 60_000 })
  const audit = new InMemoryDashboardAuditLogRegistry()
  const agent = createTestAgent()
  const changedAgent = {
    ...agent,
    updatedAt: '2026-05-09T12:01:00.000Z',
    status: 'suspended' as const,
  }
  let reads = 0
  const app = express()
  app.use(express.json())
  registerAgentRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      baseDir: '/tmp/palmos-agent-conflict-test',
      workspace: {
        agentRegistry: {
          get: async () => {
            reads += 1
            return reads === 1 ? agent : changedAgent
          },
          put: async () => undefined,
          putIfUpdatedAt: async () => false,
          list: async () => [changedAgent],
          getByActorId: async () => undefined,
          getByWalletId: async () => undefined,
          remove: async () => undefined,
        },
        dashboardAuditLogRegistry: audit,
      },
      buildDashboardSnapshot: async () => ({
        summary: {},
      }),
    } as never,
  )

  const response = await invokeRoute({
    app,
    path: '/api/dashboard/agents/:agentId/policy',
    method: 'patch',
    headers: {
      'content-type': 'application/json',
      cookie: `palmos_operator_session=${encodeURIComponent(operatorToken)}`,
    },
    params: {
      agentId: agent.agentId,
    },
    body: {
      maxPerTransaction: '0.50',
    },
  })
  const body = response.body as {
    error: string
    details: {
      currentStatus: string
    }
  }

  assert.equal(response.statusCode, 409, JSON.stringify(body))
  assert.equal(body.error, 'agent_conflict')
  assert.equal(body.details.currentStatus, 'suspended')

  const auditRecords = await audit.list()
  assert.equal(auditRecords.length, 1)
  assert.equal(auditRecords[0]?.action, 'agent.policy.update')
  assert.equal(auditRecords[0]?.status, 'failed')
  assert.equal(auditRecords[0]?.metadata?.errorCode, 'agent_conflict')
})

test('service disable endpoint audits stale service updates as conflicts', async () => {
  const now = Date.now()
  const operatorToken = operatorSessionToken({ role: 'operator', expiresAt: now + 60_000 })
  const audit = new InMemoryDashboardAuditLogRegistry()
  const service = createRegisteredServiceRecord({
    serviceId: 'service_disable_race',
    status: 'active',
  })
  const changedService = {
    ...service,
    updatedAt: '2026-05-09T12:01:00.000Z',
    status: 'disabled' as const,
  }
  let reads = 0
  const app = express()
  app.use(express.json())
  registerServiceRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      baseDir: '/tmp/palmos-service-conflict-test',
      workspace: {
        serviceRegistry: {
          get: async () => {
            reads += 1
            return reads === 1 ? service : changedService
          },
          put: async () => undefined,
          putIfUpdatedAt: async () => false,
          list: async () => [changedService],
          remove: async () => undefined,
        },
        dashboardAuditLogRegistry: audit,
      },
      buildPalmosServiceCatalog: async () => ({}),
    } as never,
  )

  const response = await invokeRoute({
    app,
    path: '/api/dashboard/services/:serviceId/disable',
    method: 'post',
    headers: {
      'content-type': 'application/json',
      cookie: `palmos_operator_session=${encodeURIComponent(operatorToken)}`,
    },
    params: {
      serviceId: service.serviceId,
    },
    body: {},
  })
  const body = response.body as {
    error: string
    details: {
      currentStatus: string
    }
  }

  assert.equal(response.statusCode, 409, JSON.stringify(body))
  assert.equal(body.error, 'service_conflict')
  assert.equal(body.details.currentStatus, 'disabled')

  const auditRecords = await audit.list()
  assert.equal(auditRecords.length, 1)
  assert.equal(auditRecords[0]?.action, 'service.disable')
  assert.equal(auditRecords[0]?.status, 'failed')
  assert.equal(auditRecords[0]?.metadata?.errorCode, 'service_conflict')
})

test('operator disable endpoint audits stale operator updates as conflicts', async () => {
  const now = Date.now()
  const ownerToken = operatorSessionToken({ role: 'owner', expiresAt: now + 60_000 })
  const audit = new InMemoryDashboardAuditLogRegistry()
  const operator = createDashboardOperatorRecord({
    env: {
      PALMOS_WORKSPACE_ID: 'workspace_test',
    },
    patch: {
      operatorId: 'operator_race',
      displayName: 'Race Operator',
      role: 'operator',
    },
    now: () => '2026-05-09T12:00:00.000Z',
  })!
  const changedOperator = {
    ...operator,
    status: 'disabled' as const,
    updatedAt: '2026-05-09T12:01:00.000Z',
  }
  let reads = 0
  const app = express()
  app.use(express.json())
  registerSystemRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      baseDir: '/tmp/palmos-operator-conflict-test',
      workspace: {
        dashboardOperatorRegistry: {
          get: async () => {
            reads += 1
            return reads === 1 ? operator : changedOperator
          },
          put: async () => undefined,
          putIfUpdatedAt: async () => false,
          list: async () => [changedOperator],
          remove: async () => undefined,
        },
        dashboardAuditLogRegistry: audit,
      },
    } as never,
  )

  const response = await invokeRoute({
    app,
    path: '/api/dashboard/operators/:operatorId/disable',
    method: 'post',
    headers: {
      'content-type': 'application/json',
      cookie: `palmos_operator_session=${encodeURIComponent(ownerToken)}`,
    },
    params: {
      operatorId: operator.operatorId,
    },
    body: {},
  })
  const body = response.body as {
    error: string
    details: {
      currentStatus: string
    }
  }

  assert.equal(response.statusCode, 409, JSON.stringify(body))
  assert.equal(body.error, 'operator_conflict')
  assert.equal(body.details.currentStatus, 'disabled')

  const auditRecords = await audit.list()
  assert.equal(auditRecords.length, 1)
  assert.equal(auditRecords[0]?.action, 'operator.disable')
  assert.equal(auditRecords[0]?.status, 'failed')
  assert.equal(auditRecords[0]?.metadata?.errorCode, 'operator_conflict')
})

test('workspace update endpoint audits stale workspace updates as conflicts', async () => {
  const now = Date.now()
  const ownerToken = operatorSessionToken({ role: 'owner', expiresAt: now + 60_000 })
  const audit = new InMemoryDashboardAuditLogRegistry()
  const workspace = await ensureDashboardWorkspaceRecord({
    registry: new InMemoryDashboardWorkspaceRegistry(),
    env: {
      PALMOS_WORKSPACE_ID: 'workspace_race',
      PALMOS_WORKSPACE_NAME: 'Race Workspace',
    },
    now: () => '2026-05-09T12:00:00.000Z',
  })
  const changedWorkspace = {
    ...workspace,
    displayName: 'Changed Workspace',
    updatedAt: '2026-05-09T12:01:00.000Z',
  }
  let reads = 0
  const app = express()
  app.use(express.json())
  registerSystemRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
        PALMOS_WORKSPACE_ID: workspace.workspaceId,
      },
      baseDir: '/tmp/palmos-workspace-conflict-test',
      workspace: {
        dashboardWorkspaceRegistry: {
          get: async () => {
            reads += 1
            return reads === 1 ? workspace : changedWorkspace
          },
          put: async () => undefined,
          putIfUpdatedAt: async () => false,
          list: async () => [changedWorkspace],
          remove: async () => undefined,
        },
        dashboardAuditLogRegistry: audit,
      },
    } as never,
  )

  const response = await invokeRoute({
    app,
    path: '/api/dashboard/workspace',
    method: 'patch',
    headers: {
      'content-type': 'application/json',
      cookie: `palmos_operator_session=${encodeURIComponent(ownerToken)}`,
    },
    body: {
      displayName: 'Updated Workspace',
    },
  })
  const body = response.body as {
    error: string
    details: {
      currentStatus: string
    }
  }

  assert.equal(response.statusCode, 409, JSON.stringify(body))
  assert.equal(body.error, 'workspace_conflict')
  assert.equal(body.details.currentStatus, 'active')

  const auditRecords = await audit.list()
  assert.equal(auditRecords.length, 1)
  assert.equal(auditRecords[0]?.action, 'workspace.update')
  assert.equal(auditRecords[0]?.status, 'failed')
  assert.equal(auditRecords[0]?.metadata?.errorCode, 'workspace_conflict')
})

test('Postgres lifecycle commit rolls back agent update when wallet claim fails', async () => {
  const agent = createTestAgent()
  const wallet = {
    walletId: agent.walletId!,
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    state: 'active_limited' as const,
    organizationId: agent.organizationId,
    treasuryId: 'treasury_test',
    subjectId: agent.agentId,
    walletType: 'ops' as const,
    complianceStatus: 'approved' as const,
    policyAttachmentStatus: 'attached' as const,
    signerHealthStatus: 'healthy' as const,
    trustStatus: 'sufficient' as const,
  }
  const queries: string[] = []
  const client = {
    query: async (sql: string) => {
      queries.push(sql.trim().split(/\s+/).slice(0, 3).join(' '))
      if (sql.includes('update agents')) {
        return { rowCount: 1 }
      }
      if (sql.includes('update wallets')) {
        return { rowCount: 0 }
      }
      return { rowCount: 0 }
    },
    release: () => undefined,
  }
  const result = await commitAgentLifecycleUpdate({
    workspace: {
      postgresPool: {
        connect: async () => client,
      },
      agentRegistry: new InMemoryAgentRegistry([agent]),
      walletRegistry: new InMemoryWalletRegistry([wallet]),
    } as never,
    previousAgent: agent,
    nextAgent: {
      ...agent,
      updatedAt: '2026-05-09T12:01:00.000Z',
      status: 'suspended',
      walletState: 'suspended',
    },
    previousWallet: wallet,
    nextWallet: {
      ...wallet,
      updatedAt: '2026-05-09T12:01:00.000Z',
      state: 'suspended',
    },
  })

  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.code, 'wallet_conflict')
  assert.deepEqual(queries, [
    'begin',
    'update agents set',
    'update wallets set',
    'rollback',
  ])
})

test('paid call blocks invalid requested amount before runtime execution', async () => {
  const agent = createTestAgent({ sessionBudget: '1' })
  const result = await executePaidServiceCall(
    {
      kernel: fakeKernel as never,
      agentRegistry: new InMemoryAgentRegistry([agent]),
      paidCalls: new InMemoryPaidCallRegistry(),
      serviceCatalog: {
        [budgetService.serviceId]: budgetService,
      },
      createId: () => 'paid_call_invalid_amount',
      now: () => '2026-05-09T12:00:00.000Z',
    },
    {
      agentId: agent.agentId,
      serviceId: budgetService.serviceId,
      request: {},
      amount: '0.0000001',
    },
  )

  assert.equal(result.kind, 'blocked')
  assert.equal(result.execution.status, 'blocked')
  assert.equal(result.execution.errorCode, 'policy.invalid_amount')
  assert.match(result.reason, /Invalid requested payment amount/)
})

test('session budget accounting uses exact PUSD base units', async () => {
  const agent = createTestAgent({
    sessionBudget: '0.3',
    maxPerTransaction: '0.3',
    autoApproveUnder: '0.3',
  })
  const existingCall: PaidCallRecord = {
    executionId: 'paid_call_existing',
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    agentId: agent.agentId,
    serviceId: budgetService.serviceId,
    vendorId: budgetService.vendorId,
    paymentRail: PALMOS_PAYMENT_RAIL,
    settlementMode: 'local-demo',
    amount: '0.1',
    assetSymbol: 'PUSD',
    chainId: 'solana-mainnet',
    status: 'executed',
    sessionId: agent.sessionId,
    requestPayload: {},
    requestSummary: {},
  }

  const result = await executePaidServiceCall(
    {
      kernel: fakeKernel as never,
      agentRegistry: new InMemoryAgentRegistry([agent]),
      paidCalls: new InMemoryPaidCallRegistry([existingCall]),
      serviceCatalog: {
        [budgetService.serviceId]: budgetService,
      },
      createId: () => 'paid_call_decimal_budget',
      now: () => '2026-05-09T12:00:00.000Z',
    },
    {
      agentId: agent.agentId,
      serviceId: budgetService.serviceId,
      request: {},
      amount: '0.2',
    },
  )

  assert.notEqual(result.kind, 'blocked')
})

test('paid service fetch forces redirect blocking', async () => {
  let observedRedirect: RequestRedirect | undefined
  const response = await fetchWithTimeout(
    async (_url, init) => {
      observedRedirect = init?.redirect
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    },
    'https://payments.example.com/api',
    {
      redirect: 'follow',
    },
  )

  assert.equal(response.status, 200)
  assert.equal(observedRedirect, 'error')

  const redirectedResponse = new Response('redirected', {
    status: 200,
  })
  Object.defineProperty(redirectedResponse, 'redirected', {
    value: true,
  })
  await assert.rejects(
    fetchWithTimeout(
      async () => redirectedResponse,
      'https://payments.example.com/api',
      undefined,
    ),
    /redirects are blocked/,
  )
})

test('registered service catalog preserves verification state and skips disabled services', () => {
  const serviceBase = {
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    label: 'Registered Service',
    vendorId: 'registered_vendor',
    destinationAddress: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
    endpointUrl: 'https://payments.example.com/api',
    method: 'POST' as const,
    requestMode: 'json' as const,
    expectedAmount: '0.01',
    chainId: 'solana-mainnet' as const,
  }

  const catalog = mergeRegisteredPalmosServices({
    baseCatalog: {},
    services: [
      {
        ...serviceBase,
        serviceId: 'custom.verified',
        status: 'active',
        verificationStatus: 'verified',
      },
      {
        ...serviceBase,
        serviceId: 'custom.unchecked',
        status: 'active',
        verificationStatus: 'unchecked',
      },
      {
        ...serviceBase,
        serviceId: 'custom.disabled',
        status: 'disabled',
        verificationStatus: 'verified',
      },
    ],
  })

  assert.equal(catalog['custom.verified']?.source, 'registered')
  assert.equal(catalog['custom.verified']?.verificationStatus, 'verified')
  assert.equal(catalog['custom.unchecked']?.verificationStatus, 'unchecked')
  assert.equal(catalog['custom.disabled'], undefined)
})

test('service readiness reports recipient, endpoint, and amount failures', async () => {
  const service: PalmosPaidServiceDefinition<Record<string, unknown>> = {
    ...budgetService,
    serviceId: 'custom.readiness.service',
    source: 'registered',
    verificationStatus: 'verified',
    expectedAmount: '0.02',
  }
  const result = await evaluatePalmosServiceReadiness({
    service,
    destinationAddress: 'not-a-solana-address',
    endpointUrl: 'https://payments.example.com/api',
    requestedAmount: '0.01',
    requireVerified: true,
    requireSafeEndpoint: true,
    lookup: async () => [
      {
        address: '10.0.0.10',
        family: 4,
      },
    ],
  })

  assert.equal(result.ok, false)
  assert.deepEqual(
    result.checks.map((check) => check.code),
    [
      'service.amount_mismatch',
      'service.invalid_recipient',
      'service.unsafe_endpoint',
    ],
  )
  assert.match(formatServiceReadinessFailure(result), /amount_mismatch/)
})

test('service readiness accepts verified registered PUSD service', async () => {
  const service: PalmosPaidServiceDefinition<Record<string, unknown>> = {
    ...budgetService,
    serviceId: 'custom.ready.service',
    source: 'registered',
    verificationStatus: 'verified',
  }
  const result = await evaluatePalmosServiceReadiness({
    service,
    destinationAddress: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
    endpointUrl: 'https://payments.example.com/api',
    requestedAmount: '0.01',
    requireVerified: true,
    requireSafeEndpoint: true,
    lookup: async () => [
      {
        address: '93.184.216.34',
        family: 4,
      },
    ],
  })

  assert.deepEqual(result, {
    ok: true,
    checks: [],
  })
})

function createRegisteredServiceRecord(
  input: Partial<RegisteredPalmosServiceRecord> = {},
): RegisteredPalmosServiceRecord {
  return {
    serviceId: 'custom.lifecycle.service',
    createdAt: '2026-05-09T12:00:00.000Z',
    updatedAt: '2026-05-09T12:00:00.000Z',
    label: 'Lifecycle Service',
    vendorId: 'registered_vendor',
    destinationAddress: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
    endpointUrl: 'https://payments.example.com/api',
    method: 'POST',
    requestMode: 'json',
    expectedAmount: '0.01',
    chainId: 'solana-mainnet',
    status: 'active',
    verificationStatus: 'unchecked',
    ...input,
  }
}

test('service verification lifecycle records success and failure metadata', async () => {
  const successful = await verifyRegisteredPalmosServiceRecord({
    record: createRegisteredServiceRecord(),
    now: () => '2026-05-09T12:05:00.000Z',
    lookup: async () => [
      {
        address: '93.184.216.34',
        family: 4,
      },
    ],
  })
  assert.equal(successful.readiness.ok, true)
  assert.equal(successful.record.verificationStatus, 'verified')
  assert.equal(successful.record.verifiedAt, '2026-05-09T12:05:00.000Z')
  assert.equal(successful.record.lastVerificationError, undefined)

  const failed = await verifyRegisteredPalmosServiceRecord({
    record: createRegisteredServiceRecord(),
    now: () => '2026-05-09T12:06:00.000Z',
    allowedHostnames: ['api.trusted.example'],
    lookup: async () => [
      {
        address: '93.184.216.34',
        family: 4,
      },
    ],
  })
  assert.equal(failed.readiness.ok, false)
  assert.equal(failed.record.verificationStatus, 'failed')
  assert.equal(failed.record.verifiedAt, undefined)
  assert.match(failed.record.lastVerificationError ?? '', /hostname_not_allowlisted/)
})

test('service enable and disable preserve verification metadata', () => {
  const verifiedAt = '2026-05-09T12:05:00.000Z'
  const record = createRegisteredServiceRecord({
    verificationStatus: 'verified',
    verifiedAt,
  })
  const disabled = setRegisteredPalmosServiceStatus({
    record,
    status: 'disabled',
    now: () => '2026-05-09T12:07:00.000Z',
  })
  assert.equal(disabled.status, 'disabled')
  assert.equal(disabled.verificationStatus, 'verified')
  assert.equal(disabled.verifiedAt, verifiedAt)
  assert.equal(disabled.updatedAt, '2026-05-09T12:07:00.000Z')

  const enabled = setRegisteredPalmosServiceStatus({
    record: disabled,
    status: 'active',
    now: () => '2026-05-09T12:08:00.000Z',
  })
  assert.equal(enabled.status, 'active')
  assert.equal(enabled.verificationStatus, 'verified')
  assert.equal(enabled.verifiedAt, verifiedAt)
  assert.equal(enabled.updatedAt, '2026-05-09T12:08:00.000Z')
})

test('service readiness rejects disabled registered services', async () => {
  const registeredService = createRegisteredServiceRecord({
    status: 'disabled',
    verificationStatus: 'verified',
  })
  const service: PalmosPaidServiceDefinition<Record<string, unknown>> = {
    ...budgetService,
    serviceId: registeredService.serviceId,
    source: 'registered',
    verificationStatus: 'verified',
  }
  const result = await evaluatePalmosServiceReadiness({
    service,
    registeredService,
    destinationAddress: registeredService.destinationAddress,
    endpointUrl: registeredService.endpointUrl,
    requestedAmount: registeredService.expectedAmount,
    requireVerified: true,
    requireSafeEndpoint: true,
    lookup: async () => [
      {
        address: '93.184.216.34',
        family: 4,
      },
    ],
  })

  assert.equal(result.ok, false)
  assert.equal(result.checks[0]?.code, 'service.disabled')
})

test('real settlement blocks registered services outside endpoint allowlist', async () => {
  const agent = createTestAgent({
    settlementMode: 'real-solana',
  })
  const paidCalls = new InMemoryPaidCallRegistry()
  const service: PalmosPaidServiceDefinition<Record<string, unknown>> = {
    ...budgetService,
    serviceId: 'custom.allowlist.blocked',
    source: 'registered',
    verificationStatus: 'verified',
    buildRequest: () => ({
      url: 'https://payments.example.com/api',
      init: { method: 'POST' },
      requestSummary: {},
    }),
  }

  const result = await executePaidServiceCall(
    {
      kernel: fakeKernel as never,
      agentRegistry: new InMemoryAgentRegistry([agent]),
      paidCalls,
      palmosClient: fakePalmosClient as never,
      serviceCatalog: {
        [service.serviceId]: service,
      },
      serviceEndpointAllowlist: ['api.trusted.example'],
      serviceEndpointLookup: async () => [
        {
          address: '93.184.216.34',
          family: 4,
        },
      ],
      createId: () => 'paid_call_allowlist_blocked',
      now: () => '2026-05-09T12:00:00.000Z',
    },
    {
      agentId: agent.agentId,
      serviceId: service.serviceId,
      request: {},
      amount: '0.01',
    },
  )

  assert.equal(result.kind, 'blocked')
  assert.equal(result.execution.errorCode, 'service.unsafe_endpoint')
  assert.match(result.reason, /hostname_not_allowlisted/)
})

test('real settlement blocks unverified registered services before execution', async () => {
  const agent = createTestAgent({
    settlementMode: 'real-solana',
  })
  const paidCalls = new InMemoryPaidCallRegistry()
  const service: PalmosPaidServiceDefinition<Record<string, unknown>> = {
    ...budgetService,
    serviceId: 'custom.unverified.service',
    source: 'registered',
    verificationStatus: 'unchecked',
  }

  const result = await executePaidServiceCall(
    {
      kernel: fakeKernel as never,
      agentRegistry: new InMemoryAgentRegistry([agent]),
      paidCalls,
      palmosClient: fakePalmosClient as never,
      serviceCatalog: {
        [service.serviceId]: service,
      },
      createId: () => 'paid_call_unverified_service',
      now: () => '2026-05-09T12:00:00.000Z',
    },
    {
      agentId: agent.agentId,
      serviceId: service.serviceId,
      request: {},
      amount: '0.01',
    },
  )

  assert.equal(result.kind, 'blocked')
  assert.equal(result.execution.errorCode, 'service.unverified')
  assert.equal(
    (await paidCalls.get('paid_call_unverified_service'))?.status,
    'blocked',
  )
})

test('registered service endpoint safety blocks local and private targets', async () => {
  assert.deepEqual(
    await validateRegisteredServiceEndpoint({
      endpointUrl: 'http://localhost:4021/pay',
    }),
    {
      ok: false,
      reason: 'blocked_hostname',
    },
  )

  assert.deepEqual(
    await validateRegisteredServiceEndpoint({
      endpointUrl: 'https://10.0.0.10/pay',
    }),
    {
      ok: false,
      reason: 'blocked_ip',
    },
  )

  assert.deepEqual(
    await validateRegisteredServiceEndpoint({
      endpointUrl: 'https://[::1]/pay',
    }),
    {
      ok: false,
      reason: 'blocked_ip',
    },
  )
})

test('registered service endpoint safety blocks DNS records resolving to private IPs', async () => {
  const result = await validateRegisteredServiceEndpoint({
    endpointUrl: 'https://payments.example.com/api',
    lookup: async () => [
      {
        address: '192.168.1.10',
        family: 4,
      },
    ],
  })

  assert.deepEqual(result, {
    ok: false,
    reason: 'blocked_ip',
  })
})

test('registered service endpoint safety enforces optional hostname allowlist', async () => {
  const blocked = await validateRegisteredServiceEndpoint({
    endpointUrl: 'https://payments.example.com/api',
    allowedHostnames: ['api.trusted.example'],
    lookup: async () => [
      {
        address: '93.184.216.34',
        family: 4,
      },
    ],
  })
  assert.deepEqual(blocked, {
    ok: false,
    reason: 'hostname_not_allowlisted',
  })

  const allowed = await validateRegisteredServiceEndpoint({
    endpointUrl: 'https://payments.trusted.example/api',
    allowedHostnames: ['*.trusted.example'],
    lookup: async () => [
      {
        address: '93.184.216.34',
        family: 4,
      },
    ],
  })
  assert.equal(allowed.ok, true)
})

test('registered service input accepts safe endpoint and rejects invalid recipient', async () => {
  const valid = await readRegisteredServiceInput(
    {
      serviceId: 'custom.safe.service',
      label: 'Custom Safe Service',
      vendorId: 'custom_safe_vendor',
      endpointUrl: 'https://payments.example.com/api',
      destinationAddress: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
      expectedAmount: '0.01',
    },
    {},
    {
      lookup: async () => [
        {
          address: '93.184.216.34',
          family: 4,
        },
      ],
    },
  )

  assert.equal(valid?.serviceId, 'custom.safe.service')
  assert.equal(valid?.endpointUrl, 'https://payments.example.com/api')
  assert.equal(valid?.destinationAddress, '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy')

  const invalidRecipient = await readRegisteredServiceInput(
    {
      serviceId: 'custom.bad.service',
      endpointUrl: 'https://payments.example.com/api',
      destinationAddress: 'not-a-solana-address',
      expectedAmount: '0.01',
    },
    {},
    {
      lookup: async () => [
        {
          address: '93.184.216.34',
          family: 4,
        },
      ],
    },
  )

  assert.equal(invalidRecipient, undefined)
})

test('registered service input rejects endpoints outside configured allowlist', async () => {
  const rejected = await readRegisteredServiceInput(
    {
      serviceId: 'custom.blocked.service',
      endpointUrl: 'https://payments.example.com/api',
      destinationAddress: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
      expectedAmount: '0.01',
    },
    {
      PALMOS_SERVICE_ENDPOINT_ALLOWLIST: 'api.trusted.example',
    },
    {
      lookup: async () => [
        {
          address: '93.184.216.34',
          family: 4,
        },
      ],
    },
  )
  assert.equal(rejected, undefined)

  const accepted = await readRegisteredServiceInput(
    {
      serviceId: 'custom.allowed.service',
      endpointUrl: 'https://api.trusted.example/pay',
      destinationAddress: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
      expectedAmount: '0.01',
    },
    {
      PALMOS_SERVICE_ENDPOINT_ALLOWLIST: 'https://api.trusted.example',
    },
    {
      lookup: async () => [
        {
          address: '93.184.216.34',
          family: 4,
        },
      ],
    },
  )
  assert.equal(accepted?.serviceId, 'custom.allowed.service')
  assert.equal(accepted?.verificationStatus, 'verified')
})
