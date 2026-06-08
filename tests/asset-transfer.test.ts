import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import {
  DefaultSessionKernel,
  DeterministicBroadcaster,
  DeterministicSignerGateway,
  FileKernelPersistence,
  InMemoryRunRegistry,
  InMemorySessionRegistry,
  InMemoryWalletRegistry,
  type WalletRecord,
} from '../runtime/index.js'
import {
  reconcileNativeActionRequests,
  requestAssetTransfer,
  resolvePendingAssetTransferApproval,
} from '../src/app/requestAssetTransfer.js'
import { reconcileWalletActions } from '../src/app/reconcileWalletActions.js'
import { createAgentCredential } from '../src/app/createAgentCredential.js'
import { createAgentPolicyCandidateResolver } from '../src/policies/compileAgentPolicy.js'
import { signDashboardAccessExpiry } from '../src/server/dashboard/access.js'
import { createDashboardMutationIdempotencyStore } from '../src/server/dashboard/mutationIdempotency.js'
import { createDashboardOperationalMetricsStore } from '../src/server/dashboard/operationalMetrics.js'
import { registerSdkRoutes } from '../src/server/dashboard/routes/sdkRoutes.js'
import { registerSystemRoutes } from '../src/server/dashboard/routes/systemRoutes.js'
import { InMemoryActionRequestRegistry } from '../src/store/ActionRequestRegistry.js'
import { InMemoryAgentCredentialRegistry } from '../src/store/AgentCredentialRegistry.js'
import {
  InMemoryAgentRegistry,
  type AgentRecord,
} from '../src/store/AgentRegistry.js'
import { InMemoryDashboardAuditLogRegistry } from '../src/store/DashboardAuditLogRegistry.js'
import { InMemoryPaidCallRegistry } from '../src/store/PaidCallRegistry.js'
import {
  createSdkIdempotentActionRequestId,
  existingActionRequestToSdkResult,
  isSameSdkIdempotentTransferRequest,
} from '../src/server/dashboard/sdkIdempotency.js'

const NOW = '2026-06-05T12:00:00.000Z'

function createIdFactory(): (prefix: string) => string {
  let sequence = 0
  return (prefix: string) => `${prefix}_${++sequence}`
}

function createWallet(overrides: Partial<WalletRecord> = {}): WalletRecord {
  return {
    walletId: 'wallet_transfer_test',
    createdAt: NOW,
    updatedAt: NOW,
    state: 'active_full',
    organizationId: 'org_test',
    treasuryId: 'treasury_test',
    subjectId: 'agent_transfer_test',
    walletType: 'ops',
    address: '0xsource000000000000000000000000000000000000',
    supportedChains: ['solana-devnet'],
    signerProfileId: 'multisig_default',
    providerId: 'deterministic_wallet_provider',
    complianceStatus: 'approved',
    policyAttachmentStatus: 'attached',
    signerHealthStatus: 'healthy',
    trustStatus: 'sufficient',
    ...overrides,
  }
}

function createAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: 'agent_transfer_test',
    createdAt: NOW,
    updatedAt: NOW,
    displayName: 'Transfer Test Agent',
    organizationId: 'org_test',
    treasuryId: 'treasury_test',
    environment: 'test',
    actorId: 'actor_transfer_test',
    sessionId: 'session_transfer_test',
    walletType: 'ops',
    walletId: 'wallet_transfer_test',
    walletState: 'active_full',
    signerProfileId: 'multisig_default',
    policyProfileId: 'policy_transfer_test',
    policyConfig: {
      agentId: 'agent_transfer_test',
      organizationId: 'org_test',
      environment: 'test',
      walletType: 'ops',
      allowedChains: ['solana-devnet'],
      allowedAssets: ['PUSD'],
      allowedSignerClasses: ['multisig'],
      allowedVendors: [
        {
          vendorId: 'counterparty_ops',
          label: 'Ops Counterparty',
          destinationAddress: 'counterparty_destination',
          chainId: 'solana-devnet',
        },
      ],
      autoApproveUnder: '5',
      maxPerTransaction: '25',
      transferPolicy: {
        allowedRecipients: [
          {
            counterpartyId: 'counterparty_ops',
            label: 'Ops Counterparty',
            destinationAddress: 'counterparty_destination',
            chainId: 'solana-devnet',
          },
        ],
        allowedAssets: ['PUSD'],
        allowedChains: ['solana-devnet'],
        autoApproveUnder: '5',
        maxPerTransfer: '25',
      },
      heartbeatTimeoutSeconds: 300,
      requireSanctionsScreening: true,
      policyProfileId: 'policy_transfer_test',
    },
    trustTier: 'healthy',
    status: 'ready',
    lastCheckInAt: NOW,
    ...overrides,
  }
}

async function createTransferDeps(input: {
  signerMode?: ConstructorParameters<typeof DeterministicSignerGateway>[0]
  broadcasterMode?: ConstructorParameters<typeof DeterministicBroadcaster>[0]['mode']
  agent?: AgentRecord
  wallet?: WalletRecord
}) {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-asset-transfer-'))
  const createId = createIdFactory()
  const agentRegistry = new InMemoryAgentRegistry([
    input.agent ?? createAgent(),
  ])
  const actionRequests = new InMemoryActionRequestRegistry()
  const runRegistry = new InMemoryRunRegistry()
  const walletRegistry = new InMemoryWalletRegistry([
    input.wallet ?? createWallet(),
  ])
  const kernel = new DefaultSessionKernel({
    persistence: new FileKernelPersistence(dir),
    sessions: new InMemorySessionRegistry(),
    runs: runRegistry,
    walletRegistry,
    signerGateway: new DeterministicSignerGateway(input.signerMode ?? 'pending'),
    broadcaster: new DeterministicBroadcaster({
      now: () => NOW,
      createId,
      mode: input.broadcasterMode,
    }),
    getPolicyCandidates: createAgentPolicyCandidateResolver({
      agentRegistry,
      now: () => NOW,
    }),
    now: () => NOW,
    createId,
  })

  return {
    dir,
    deps: {
      kernel,
      agentRegistry,
      actionRequests,
      runRegistry,
      now: () => NOW,
      createId,
    },
    actionRequests,
    agentRegistry,
  }
}

async function invokeApp(
  app: express.Express,
  input: {
    method: string
    path: string
    headers?: Record<string, string>
    body?: unknown
  },
): Promise<{
  status: number
  headers: Record<string, string>
  body: unknown
}> {
  const bodyText =
    input.body === undefined ? undefined : JSON.stringify(input.body)
  const req = new Readable({
    read() {
      if (bodyText !== undefined) {
        this.push(bodyText)
      }
      this.push(null)
    },
  }) as unknown as express.Request
  req.method = input.method
  req.url = input.path
  req.headers = {
    ...(input.headers ?? {}),
    ...(bodyText !== undefined
      ? {
          'content-length': Buffer.byteLength(bodyText).toString(),
        }
      : {}),
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const headers: Record<string, string> = {}
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        callback()
      },
    }) as unknown as express.Response
    res.statusCode = 200
    res.setHeader = (name: string, value: number | string | readonly string[]) => {
      headers[name.toLowerCase()] = Array.isArray(value)
        ? value.join(', ')
        : String(value)
      return res
    }
    res.getHeader = (name: string) => headers[name.toLowerCase()]
    res.getHeaders = () => ({ ...headers })
    res.removeHeader = (name: string) => {
      delete headers[name.toLowerCase()]
    }
    const originalEnd = res.end.bind(res)
    res.end = ((chunk?: unknown, encoding?: BufferEncoding | (() => void)) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      }
      originalEnd()
      const rawBody = Buffer.concat(chunks).toString('utf8')
      try {
        resolve({
          status: res.statusCode,
          headers,
          body: rawBody ? JSON.parse(rawBody) : undefined,
        })
      } catch {
        resolve({
          status: res.statusCode,
          headers,
          body: rawBody,
        })
      }
      if (typeof encoding === 'function') {
        encoding()
      }
      return res
    }) as typeof res.end

    app.handle(req, res, (error) => {
      if (error) {
        reject(error)
        return
      }
      if (!res.writableEnded) {
        res.statusCode = 404
        res.end(JSON.stringify({ ok: false, error: 'not_found' }))
      }
    })
  })
}

function createPusdReadinessRegistryStub() {
  return {
    get: async () => undefined,
    put: async () => undefined,
    list: async () => [],
    prune: async () => ({ deleted: 0, retained: 0 }),
    remove: async () => undefined,
  }
}

async function createRouteContext(input: {
  signerMode?: ConstructorParameters<typeof DeterministicSignerGateway>[0]
}) {
  const context = await createTransferDeps({
    signerMode: input.signerMode,
  })
  const agentCredentialRegistry = new InMemoryAgentCredentialRegistry()
  const credential = await createAgentCredential(
    {
      credentials: agentCredentialRegistry,
      now: () => NOW,
      createId: (prefix) => `${prefix}_route_test`,
    },
    {
      agentId: 'agent_transfer_test',
    },
  )
  const paidCallRegistry = new InMemoryPaidCallRegistry()
  const dashboardAuditLogRegistry = new InMemoryDashboardAuditLogRegistry()
  const operationalMetrics = createDashboardOperationalMetricsStore()
  const env = {
    PALMOS_OPERATOR_PASSWORD: 'operator-password',
    PALMOS_OPERATOR_SESSION_SECRET: 'operator-session-secret',
  }

  const routeContext = {
    env,
    baseDir: context.dir,
    workspace: {
      storageDriver: 'file',
      kernel: context.deps.kernel,
      agentRegistry: context.agentRegistry,
      walletRegistry: {} as never,
      actionRequestRegistry: context.actionRequests,
      paidCallRegistry,
      agentCredentialRegistry,
      dashboardAuditLogRegistry,
    },
    palmosClient: {} as never,
    pusdReadinessReports: createPusdReadinessRegistryStub(),
    operationalMetrics,
    mutationIdempotency: createDashboardMutationIdempotencyStore(),
    localDemoBaseUrl: 'http://127.0.0.1:0',
    buildPalmosServiceCatalog: async () => ({}),
    buildDashboardSnapshot: async () => ({
      generatedAt: NOW,
      baseDir: context.dir,
      headline: 'Test snapshot',
      summary: {
        agentCount: 1,
        executedCalls: 0,
        approvalPendingCalls: 0,
        blockedOrFailedCalls: 0,
        staleAgents: 0,
        xmtpAlertsSent: 0,
        owsBackedAgents: 0,
      },
      agents: [],
    }),
    runDashboardDeadMansSwitchSweep: async () => undefined,
  }

  return {
    ...context,
    credential,
    paidCallRegistry,
    dashboardAuditLogRegistry,
    env,
    routeContext,
  }
}

test('requestAssetTransfer blocks non-allowlisted native transfers without creating a PaidCall', async () => {
  const context = await createTransferDeps({})
  try {
    const result = await requestAssetTransfer(context.deps, {
      agentId: 'agent_transfer_test',
      destinationAddress: 'unknown_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '1',
      source: 'sdk',
    })

    assert.equal(result.kind, 'blocked')
    assert.equal(result.actionRequest.kind, 'asset.transfer')
    assert.equal(result.actionRequest.status, 'blocked')
    assert.equal(
      result.actionRequest.errorCode,
      'policy.transfer_recipient_not_allowed',
    )
    assert.equal(result.actionRequest.source, 'sdk')
    assert.equal((await context.agentRegistry.get('agent_transfer_test'))?.status, 'ready')
    assert.equal((await context.actionRequests.list()).length, 1)
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('requestAssetTransfer falls back to legacy vendor/payment fields when transferPolicy is absent', async () => {
  const legacyAgent = createAgent()
  delete legacyAgent.policyConfig.transferPolicy
  const context = await createTransferDeps({
    signerMode: 'signed',
    agent: legacyAgent,
  })
  try {
    const result = await requestAssetTransfer(context.deps, {
      agentId: 'agent_transfer_test',
      destinationAddress: 'counterparty_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '2',
      counterpartyId: 'counterparty_ops',
      source: 'sdk',
    })

    assert.equal(result.kind, 'executed')
    assert.equal(result.actionRequest.status, 'executed')
    assert.equal(result.actionRequest.target.kind, 'address')
    assert.equal(result.actionRequest.target.counterpartyId, 'counterparty_ops')
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('SDK transfer idempotency helpers replay matching native ActionRequests only', async () => {
  const context = await createTransferDeps({
    signerMode: 'signed',
  })
  try {
    const actionRequestId = createSdkIdempotentActionRequestId({
      agentId: 'agent_transfer_test',
      idempotencyKey: 'transfer-key-123',
    })
    const result = await requestAssetTransfer(
      {
        ...context.deps,
        createId: (prefix) =>
          prefix === 'action_request'
            ? actionRequestId
            : context.deps.createId(prefix),
      },
      {
        agentId: 'agent_transfer_test',
        destinationAddress: 'counterparty_destination',
        chainId: 'solana-devnet',
        assetSymbol: 'PUSD',
        amount: '2',
        note: 'retry-safe',
        source: 'sdk',
      },
    )

    assert.equal(result.actionRequest.actionRequestId, actionRequestId)
    assert.equal(
      isSameSdkIdempotentTransferRequest({
        actionRequest: result.actionRequest,
        destinationAddress: 'counterparty_destination',
        chainId: 'solana-devnet',
        assetSymbol: 'PUSD',
        amount: '2',
        note: 'retry-safe',
      }),
      true,
    )
    assert.equal(
      isSameSdkIdempotentTransferRequest({
        actionRequest: result.actionRequest,
        destinationAddress: 'counterparty_destination',
        chainId: 'solana-devnet',
        assetSymbol: 'PUSD',
        amount: '3',
        note: 'retry-safe',
      }),
      false,
    )
    assert.equal(
      existingActionRequestToSdkResult({
        agent: createAgent(),
        actionRequest: result.actionRequest,
      }).kind,
      'executed',
    )
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('requestAssetTransfer records approval_pending for native transfers over auto approval threshold', async () => {
  const context = await createTransferDeps({})
  try {
    const result = await requestAssetTransfer(context.deps, {
      agentId: 'agent_transfer_test',
      destinationAddress: 'counterparty_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '10',
      source: 'sdk',
    })

    assert.equal(result.kind, 'approval_pending')
    assert.equal(result.actionRequest.kind, 'asset.transfer')
    assert.equal(result.actionRequest.status, 'approval_pending')
    assert.equal(result.actionRequest.policy.approvalRequired, true)
    assert.equal(
      result.actionRequest.policy.approvalReason,
      'policy.transfer_approval_required',
    )
    assert.ok(result.actionRequest.runtimeRefs?.runId)
    assert.ok(result.actionRequest.runtimeRefs?.intentIds[0])
    assert.equal(result.actionRequest.requestContext?.legacyRecordType, undefined)
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('requestAssetTransfer waits for signature on allowed native transfers by default', async () => {
  const context = await createTransferDeps({})
  try {
    const result = await requestAssetTransfer(context.deps, {
      agentId: 'agent_transfer_test',
      destinationAddress: 'counterparty_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '2',
      counterpartyId: 'counterparty_ops',
      source: 'sdk',
    })

    assert.equal(result.kind, 'waiting_for_execution')
    assert.equal(result.actionRequest.status, 'waiting_for_execution')
    assert.equal(result.actionRequest.policy.approvalRequired, false)
    assert.equal(
      result.actionRequest.requestContext?.runtimeStatus,
      'waiting_for_signature',
    )
    assert.ok(result.actionRequest.runtimeRefs?.simulationRefs?.[0])
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('requestAssetTransfer can execute through the native runtime path without PaidCall compatibility', async () => {
  const context = await createTransferDeps({
    signerMode: 'signed',
  })
  try {
    const result = await requestAssetTransfer(context.deps, {
      agentId: 'agent_transfer_test',
      destinationAddress: 'counterparty_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '2',
      source: 'worker',
    })

    assert.equal(result.kind, 'executed')
    assert.equal(result.actionRequest.kind, 'asset.transfer')
    assert.equal(result.actionRequest.status, 'executed')
    assert.equal(
      result.actionRequest.requestContext?.runtimeStatus,
      'completed',
    )
    assert.ok(result.actionRequest.resultRef)
    assert.ok(result.actionRequest.runtimeRefs?.broadcastRefs?.[0])
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('resolvePendingAssetTransferApproval advances approved native transfers', async () => {
  const context = await createTransferDeps({
    signerMode: 'signed',
  })
  try {
    const pending = await requestAssetTransfer(context.deps, {
      agentId: 'agent_transfer_test',
      destinationAddress: 'counterparty_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '10',
      source: 'sdk',
    })

    assert.equal(pending.kind, 'approval_pending')

    const approved = await resolvePendingAssetTransferApproval(context.deps, {
      actionRequestId: pending.actionRequest.actionRequestId,
      decision: 'approved',
      approverActorId: 'operator_test',
      approverRole: 'manager',
    })

    assert.equal(approved.kind, 'executed')
    assert.equal(approved.actionRequest.status, 'executed')
    assert.equal(approved.actionRequest.policy.approvalRequired, true)
    assert.ok(approved.actionRequest.resultRef)
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('native transfer lifecycle records rejected approvals as failed terminal requests', async () => {
  const context = await createTransferDeps({})
  try {
    const pending = await requestAssetTransfer(context.deps, {
      agentId: 'agent_transfer_test',
      destinationAddress: 'counterparty_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '10',
      source: 'sdk',
    })

    assert.equal(pending.kind, 'approval_pending')
    assert.equal(pending.actionRequest.status, 'approval_pending')

    const rejected = await resolvePendingAssetTransferApproval(context.deps, {
      actionRequestId: pending.actionRequest.actionRequestId,
      decision: 'rejected',
      approverActorId: 'operator_test',
      approverRole: 'manager',
      comment: 'Risk review rejected.',
    })

    assert.equal(rejected.kind, 'execution_failed')
    assert.equal(rejected.actionRequest.status, 'failed')
    assert.equal(rejected.actionRequest.errorCode, 'approval.rejected')
    assert.match(
      rejected.actionRequest.errorMessage ?? '',
      /was rejected/,
    )

    const reconcileResult = await reconcileNativeActionRequests(context.deps)
    assert.equal(reconcileResult.checked, 0)
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('native transfer lifecycle can advance approval_pending to waiting_for_execution before execution', async () => {
  const context = await createTransferDeps({
    signerMode: 'pending',
  })
  try {
    const pending = await requestAssetTransfer(context.deps, {
      agentId: 'agent_transfer_test',
      destinationAddress: 'counterparty_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '10',
      source: 'sdk',
    })

    assert.equal(pending.kind, 'approval_pending')

    const approved = await resolvePendingAssetTransferApproval(context.deps, {
      actionRequestId: pending.actionRequest.actionRequestId,
      decision: 'approved',
      approverActorId: 'operator_test',
      approverRole: 'manager',
    })

    assert.equal(approved.kind, 'waiting_for_execution')
    assert.equal(approved.actionRequest.status, 'waiting_for_execution')
    assert.equal(
      approved.actionRequest.requestContext?.runtimeStatus,
      'waiting_for_signature',
    )
    assert.ok(approved.actionRequest.runtimeRefs?.runId)
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('native transfer lifecycle records runtime execution failure after policy approval', async () => {
  const context = await createTransferDeps({
    wallet: createWallet({
      complianceStatus: 'rejected',
    }),
  })
  try {
    const result = await requestAssetTransfer(context.deps, {
      agentId: 'agent_transfer_test',
      destinationAddress: 'counterparty_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '2',
      source: 'sdk',
    })

    assert.equal(result.kind, 'execution_failed')
    assert.equal(result.actionRequest.status, 'failed')
    assert.equal(result.actionRequest.errorCode, 'runtime.execution_failed')
    assert.match(
      result.actionRequest.errorMessage ?? '',
      /policy\.wallet_compliance_blocked/,
    )
    assert.equal(result.actionRequest.kind, 'asset.transfer')
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('reconcileNativeActionRequests advances waiting native transfers through runtime resume polling', async () => {
  const context = await createTransferDeps({
    signerMode: 'signed',
    broadcasterMode: 'confirm_on_refresh',
  })
  try {
    const pendingExecution = await requestAssetTransfer(context.deps, {
      agentId: 'agent_transfer_test',
      destinationAddress: 'counterparty_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '2',
      source: 'sdk',
    })

    assert.equal(pendingExecution.kind, 'waiting_for_execution')
    assert.equal(pendingExecution.actionRequest.status, 'waiting_for_execution')

    const result = await reconcileNativeActionRequests(context.deps)

    assert.equal(result.checked, 1)
    assert.equal(result.updated, 1)
    assert.equal(result.unchanged, 0)
    assert.equal(result.results[0]?.reason, 'runtime_resumed')
    assert.equal(result.results[0]?.nextStatus, 'executed')

    const refreshed = await context.actionRequests.get(
      pendingExecution.actionRequest.actionRequestId,
    )
    assert.equal(refreshed?.status, 'executed')
    assert.equal(refreshed?.requestContext?.runtimeStatus, 'completed')
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('reconcileNativeActionRequests refreshes stale approval_pending transfers after out-of-band approval callback', async () => {
  const context = await createTransferDeps({
    signerMode: 'signed',
  })
  try {
    const pending = await requestAssetTransfer(context.deps, {
      agentId: 'agent_transfer_test',
      destinationAddress: 'counterparty_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '10',
      source: 'sdk',
    })

    assert.equal(pending.kind, 'approval_pending')
    const runId = pending.actionRequest.runtimeRefs?.runId
    assert.ok(runId)

    await context.deps.kernel.ingestCallback({
      type: 'approval_decision',
      runId: runId!,
      status: 'approved',
      approvalStateRef:
        typeof pending.actionRequest.requestContext?.approvalStateRef === 'string'
          ? pending.actionRequest.requestContext.approvalStateRef
          : undefined,
      approvalRecord: {
        approver: {
          actorId: 'operator_test',
          role: 'manager',
        },
        decidedAt: NOW,
      },
      summary: 'Approved without dashboard review path.',
    })

    const result = await reconcileNativeActionRequests(context.deps)

    assert.equal(result.checked, 1)
    assert.equal(result.updated, 1)
    assert.equal(result.results[0]?.reason, 'runtime_synced')
    assert.equal(result.results[0]?.previousStatus, 'approval_pending')
    assert.equal(result.results[0]?.nextStatus, 'executed')

    const refreshed = await context.actionRequests.get(
      pending.actionRequest.actionRequestId,
    )
    assert.equal(refreshed?.status, 'executed')
    assert.equal(refreshed?.requestContext?.runtimeStatus, 'completed')
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('reconcileWalletActions delegates asset.transfer runtime reconciliation', async () => {
  const context = await createTransferDeps({
    signerMode: 'signed',
    broadcasterMode: 'confirm_on_refresh',
  })
  try {
    const pendingExecution = await requestAssetTransfer(context.deps, {
      agentId: 'agent_transfer_test',
      destinationAddress: 'counterparty_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '2',
      source: 'sdk',
    })

    assert.equal(pendingExecution.kind, 'waiting_for_execution')

    const result = await reconcileWalletActions(context.deps)

    assert.equal(result.transferLifecycle.checked, 1)
    assert.equal(result.transferLifecycle.updated, 1)
    assert.equal(result.transferLifecycle.results[0]?.nextStatus, 'executed')
    assert.equal(result.staleWalletActions.checked, 0)

    const refreshed = await context.actionRequests.get(
      pendingExecution.actionRequest.actionRequestId,
    )
    assert.equal(refreshed?.status, 'executed')
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('reconcileWalletActions reports stale asset.transfer intake records in dry-run mode', async () => {
  const context = await createTransferDeps({})
  try {
    await context.actionRequests.put({
      actionRequestId: 'action_request_stale_transfer',
      createdAt: NOW,
      updatedAt: NOW,
      agentId: 'agent_transfer_test',
      organizationId: 'org_test',
      treasuryId: 'treasury_test',
      walletId: 'wallet_transfer_test',
      source: 'sdk',
      kind: 'asset.transfer',
      status: 'created',
      target: {
        kind: 'address',
        address: 'counterparty_destination',
        chainId: 'solana-devnet',
      },
      value: {
        assetSymbol: 'PUSD',
        amount: '1',
        chainId: 'solana-devnet',
      },
      title: 'Transfer 1 PUSD',
      summary: 'Stale transfer intake.',
      requestPayload: {},
      policy: {
        approvalRequired: false,
      },
      executionPlan: {
        connectorKind: 'direct',
        executionMode: 'connector',
      },
      runtimeRefs: {
        sessionId: 'session_transfer_test',
        intentIds: [],
      },
    })

    const result = await reconcileWalletActions(
      {
        ...context.deps,
        now: () => '2026-06-05T12:10:00.000Z',
      },
      {
        dryRun: true,
      },
    )

    assert.equal(result.staleWalletActions.checked, 1)
    assert.equal(result.staleWalletActions.stale, 1)
    assert.equal(result.staleWalletActions.updated, 0)
    assert.equal(result.staleWalletActions.results[0]?.kind, 'asset.transfer')
    assert.equal(result.staleWalletActions.results[0]?.outcome, 'stale')

    const unchanged = await context.actionRequests.get('action_request_stale_transfer')
    assert.equal(unchanged?.status, 'created')
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('reconcileWalletActions marks stale wallet.policy_update actions as failed after timeout', async () => {
  const context = await createTransferDeps({})
  try {
    await context.actionRequests.put({
      actionRequestId: 'action_request_stale_wallet_policy',
      createdAt: NOW,
      updatedAt: NOW,
      agentId: 'agent_transfer_test',
      organizationId: 'org_test',
      treasuryId: 'treasury_test',
      walletId: 'wallet_transfer_test',
      source: 'dashboard',
      kind: 'wallet.policy_update',
      status: 'created',
      target: {
        kind: 'wallet',
        walletId: 'wallet_transfer_test',
        chainId: 'solana-devnet',
      },
      title: 'Update wallet policy',
      summary: 'Stale wallet policy update.',
      requestPayload: {
        maxPerTransaction: '3',
      },
      policy: {
        approvalRequired: false,
      },
      executionPlan: {
        connectorKind: 'direct',
        executionMode: 'connector',
      },
      requestContext: {
        nativeActionRequest: true,
        requestSource: 'dashboard',
      },
    })

    const result = await reconcileWalletActions(
      {
        ...context.deps,
        now: () => '2026-06-05T12:10:00.000Z',
      },
      {},
    )

    assert.equal(result.staleWalletActions.checked, 1)
    assert.equal(result.staleWalletActions.updated, 1)
    assert.equal(result.staleWalletActions.results[0]?.kind, 'wallet.policy_update')
    assert.equal(result.staleWalletActions.results[0]?.nextStatus, 'failed')

    const failed = await context.actionRequests.get(
      'action_request_stale_wallet_policy',
    )
    assert.equal(failed?.status, 'failed')
    assert.equal(failed?.errorCode, 'action.lifecycle_timeout')
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('SDK route idempotently replays native asset transfers and never writes PaidCall', async () => {
  const context = await createRouteContext({
    signerMode: 'signed',
  })
  const app = express()
  app.use(express.json())
  registerSdkRoutes(app, context.routeContext as never)
  try {
    const body = {
      destinationAddress: 'counterparty_destination',
      chainId: 'solana-devnet',
      assetSymbol: 'PUSD',
      amount: '2',
      note: 'sdk-route-idempotent',
    }
    const first = await invokeApp(app, {
      method: 'POST',
      path: '/api/sdk/v1/tools/request_asset_transfer',
      headers: {
        authorization: `Bearer ${context.credential.token}`,
        'content-type': 'application/json',
        'idempotency-key': 'asset-transfer-route-key',
      },
      body,
    })
    const firstPayload = first.body as Record<string, any>

    assert.equal(first.status, 200, JSON.stringify(firstPayload))
    assert.equal(firstPayload.idempotentReplay, false)
    assert.equal(firstPayload.result.kind, 'executed')
    assert.equal((await context.actionRequests.list()).length, 1)
    assert.equal((await context.paidCallRegistry.list()).length, 0)

    const replay = await invokeApp(app, {
      method: 'POST',
      path: '/api/sdk/v1/tools/request_asset_transfer',
      headers: {
        authorization: `Bearer ${context.credential.token}`,
        'content-type': 'application/json',
        'idempotency-key': 'asset-transfer-route-key',
      },
      body,
    })
    const replayPayload = replay.body as Record<string, any>

    assert.equal(replay.status, 200, JSON.stringify(replayPayload))
    assert.equal(replay.headers['idempotency-replayed'], 'true')
    assert.equal(replayPayload.idempotentReplay, true)
    assert.equal(
      replayPayload.result.actionRequest.actionRequestId,
      firstPayload.result.actionRequest.actionRequestId,
    )
    assert.equal((await context.actionRequests.list()).length, 1)
    assert.equal((await context.paidCallRegistry.list()).length, 0)

    const conflict = await invokeApp(app, {
      method: 'POST',
      path: '/api/sdk/v1/tools/request_asset_transfer',
      headers: {
        authorization: `Bearer ${context.credential.token}`,
        'content-type': 'application/json',
        'idempotency-key': 'asset-transfer-route-key',
      },
      body: {
        ...body,
        amount: '3',
      },
    })
    const conflictPayload = conflict.body as Record<string, any>

    assert.equal(conflict.status, 409, JSON.stringify(conflictPayload))
    assert.equal(conflictPayload.error, 'conflict')
    assert.equal((await context.actionRequests.list()).length, 1)
    assert.equal((await context.paidCallRegistry.list()).length, 0)
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('dashboard approval route resolves pending native asset.transfer ActionRequests', async () => {
  const context = await createRouteContext({
    signerMode: 'signed',
  })
  const pending = await requestAssetTransfer(context.deps, {
    agentId: 'agent_transfer_test',
    destinationAddress: 'counterparty_destination',
    chainId: 'solana-devnet',
    assetSymbol: 'PUSD',
    amount: '10',
    source: 'sdk',
  })
  assert.equal(pending.kind, 'approval_pending')

  const app = express()
  app.use(express.json())
  registerSystemRoutes(app, context.routeContext as never)
  try {
    const operatorToken = signDashboardAccessExpiry(
      Date.now() + 60_000,
      context.env.PALMOS_OPERATOR_SESSION_SECRET,
    )
    const response = await invokeApp(app, {
      method: 'POST',
      path: `/api/dashboard/approvals/${pending.actionRequest.actionRequestId}/approve`,
      headers: {
        'content-type': 'application/json',
        cookie: `palmos_operator_access=${encodeURIComponent(operatorToken)}`,
      },
      body: {
        comment: 'approve native route test',
      },
    })
    const payload = response.body as Record<string, any>

    assert.equal(response.status, 200, JSON.stringify(payload))
    assert.equal(payload.result.kind, 'executed')
    assert.equal(payload.result.actionRequest.status, 'executed')
    assert.equal(
      (await context.actionRequests.get(pending.actionRequest.actionRequestId))
        ?.status,
      'executed',
    )
    const audits = await context.dashboardAuditLogRegistry.list()
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.target?.type, 'action_request')
    assert.equal(audits[0]?.metadata?.actionRequestKind, 'asset.transfer')
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})
