import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { InMemoryRunRegistry } from '../runtime/index.js'
import type { WalletRecord } from '../runtime/contracts/wallet.js'
import { InMemoryWalletRegistry } from '../runtime/wallets/WalletRegistry.js'
import {
  InMemoryActionRequestRegistry,
  type ActionRequestRecord,
} from '../src/store/ActionRequestRegistry.js'
import { InMemoryAgentControlEventRegistry } from '../src/store/AgentControlEventRegistry.js'
import { InMemoryAgentRegistry } from '../src/store/AgentRegistry.js'
import { InMemoryDashboardAuditLogRegistry } from '../src/store/DashboardAuditLogRegistry.js'
import {
  InMemoryPaidCallRegistry,
  type PaidCallRecord,
} from '../src/store/PaidCallRegistry.js'
import { InMemoryXMTPAlertRegistry } from '../src/store/XMTPAlertRegistry.js'
import { operatorSessionToken, TEST_SESSION_SECRET } from './helpers/siwsAuth.js'
import { buildDashboardActionRequestDetail } from '../src/server/dashboard/actionRequestDetail.js'
import { buildDashboardActionRequestHistory } from '../src/server/dashboard/actionRequestHistory.js'
import { buildDashboardWalletActionHistory } from '../src/server/dashboard/walletActions.js'
import { buildDashboardWalletActionDetail } from '../src/server/dashboard/walletActionDetail.js'
import { buildDashboardTransactions } from '../src/server/dashboard/dashboardTransactions.js'
import { buildDashboardApprovals } from '../src/server/dashboard/dashboardApprovals.js'
import { registerActionRequestRoutes } from '../src/server/dashboard/routes/actionRequestRoutes.js'
import { registerWalletActionRoutes } from '../src/server/dashboard/routes/walletActionRoutes.js'
import { registerTransactionRoutes } from '../src/server/dashboard/routes/transactionRoutes.js'
import { registerApprovalReadRoutes } from '../src/server/dashboard/routes/approvalRoutes.js'
import type {
  PortfolioReader,
  WalletPortfolioSnapshot,
} from '../src/integrations/portfolio/types.js'

function createWallet(overrides: Partial<WalletRecord> = {}): WalletRecord {
  return {
    walletId: 'wallet_alpha',
    createdAt: '2026-06-04T09:00:00.000Z',
    updatedAt: '2026-06-04T10:00:00.000Z',
    state: 'active_full',
    organizationId: 'org_alpha',
    treasuryId: 'treasury_alpha',
    subjectId: 'agent_alpha',
    walletType: 'ops',
    address: 'AlphaWallet111',
    supportedChains: ['solana-mainnet'],
    signerProfileId: 'signer_alpha',
    providerId: 'ows_wallet_provider',
    providerWalletId: 'ows_wallet_alpha',
    providerWalletName: 'alpha-ows',
    providerVaultPath: '/vault/alpha',
    complianceStatus: 'approved',
    policyAttachmentStatus: 'attached',
    signerHealthStatus: 'healthy',
    trustStatus: 'sufficient',
    ...overrides,
  }
}

function createPaidCall(
  overrides: Partial<PaidCallRecord> = {},
): PaidCallRecord {
  return {
    executionId: 'paid_call_test',
    createdAt: '2026-06-04T11:00:00.000Z',
    updatedAt: '2026-06-04T11:00:00.000Z',
    agentId: 'agent_alpha',
    serviceId: 'service.launch.audit',
    vendorId: 'vendor_launch',
    paymentRail: 'palmos-pusd',
    settlementMode: 'ows',
    amount: '0.25',
    assetSymbol: 'PUSD',
    chainId: 'solana-mainnet',
    status: 'executed',
    walletId: 'wallet_alpha',
    requestSource: 'sdk',
    requestPayload: { prompt: 'Audit this token launch plan.' },
    requestSummary: {},
    ...overrides,
  }
}

function createActionRequest(
  overrides: Partial<ActionRequestRecord> = {},
): ActionRequestRecord {
  return {
    actionRequestId: 'action_request_test',
    createdAt: '2026-06-04T10:00:00.000Z',
    updatedAt: '2026-06-04T10:00:00.000Z',
    agentId: 'agent_alpha',
    walletId: 'wallet_alpha',
    source: 'sdk',
    kind: 'service.pay',
    status: 'approval_pending',
    target: {
      kind: 'service',
      serviceId: 'service.launch.audit',
      vendorId: 'vendor_launch',
      endpointUrl: 'https://api.example.com/launch-audit',
    },
    value: {
      assetSymbol: 'PUSD',
      amount: '0.25',
      chainId: 'solana-mainnet',
    },
    title: 'Private launch audit',
    summary: 'Agent requested a private launch audit.',
    requestPayload: {
      prompt: 'Audit this token launch plan.',
    },
    policy: {
      approvalRequired: true,
      approvalReason: 'Above auto-approval threshold.',
    },
    executionPlan: {
      connectorKind: 'umbra',
      settlementAsset: 'wSOL',
      privacyMode: 'required',
      executionMode: 'ows',
    },
    runtimeRefs: {
      sessionId: 'session_alpha',
      runId: 'run_alpha',
      intentIds: ['intent_alpha'],
    },
    ...overrides,
  }
}

function createMockResponse() {
  let statusCode = 200
  let body: unknown
  const res = {
    locals: {},
    status(code: number) {
      statusCode = code
      return this
    },
    json(payload: unknown) {
      body = payload
      return this
    },
  }

  return {
    res,
    read() {
      return {
        statusCode,
        body,
      }
    },
  }
}

function createAgent(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'agent_alpha',
    createdAt: '2026-06-04T09:00:00.000Z',
    updatedAt: '2026-06-04T10:00:00.000Z',
    displayName: 'Alpha Agent',
    organizationId: 'org_alpha',
    environment: 'production',
    actorId: 'actor_alpha',
    sessionId: 'session_alpha',
    walletType: 'ops',
    walletId: 'wallet_alpha',
    walletState: 'active_full',
    signerProfileId: 'multisig_default',
    policyProfileId: 'policy_alpha',
    policyConfig: {
      agentId: 'agent_alpha',
      organizationId: 'org_alpha',
      environment: 'production',
      walletType: 'ops',
      allowedChains: ['solana-mainnet'],
      allowedAssets: ['PUSD'],
      allowedSignerClasses: ['multisig'],
      allowedVendors: [],
      autoApproveUnder: '0.05',
      maxPerTransaction: '2',
      heartbeatTimeoutSeconds: 300,
    },
    trustTier: 'healthy',
    status: 'ready',
    lastCheckInAt: '2026-06-04T10:00:00.000Z',
    ...overrides,
  } as const
}

test('buildDashboardActionRequestHistory filters, summarizes, and caps results', async () => {
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'action_request_1',
      updatedAt: '2026-06-04T12:00:00.000Z',
      source: 'sdk',
      status: 'approval_pending',
    }),
    createActionRequest({
      actionRequestId: 'action_request_2',
      updatedAt: '2026-06-04T12:05:00.000Z',
      source: 'worker',
      status: 'executed',
      kind: 'asset.transfer',
      agentId: 'agent_beta',
      title: 'Treasury transfer',
      summary: 'Transferred 3 PUSD to treasury.',
      value: {
        assetSymbol: 'PUSD',
        amount: '3',
        chainId: 'solana-mainnet',
      },
      policy: {
        approvalRequired: false,
      },
      executionPlan: {
        connectorKind: 'pusd',
        settlementAsset: 'PUSD',
        privacyMode: 'off',
        executionMode: 'local-demo',
      },
    }),
    createActionRequest({
      actionRequestId: 'action_request_3',
      updatedAt: '2026-06-04T12:10:00.000Z',
      source: 'sdk',
      status: 'failed',
      errorCode: 'quote_expired',
      errorMessage: 'Quote expired before approval.',
    }),
  ])
  ;(actionRequests as InMemoryActionRequestRegistry & {
    list: () => Promise<ActionRequestRecord[]>
  }).list = async () => {
    throw new Error('buildDashboardActionRequestHistory should use registry.query()')
  }

  const history = await buildDashboardActionRequestHistory({
    workspace: {
      storageDriver: 'file',
      actionRequestRegistry: actionRequests,
    } as never,
    query: {
      source: 'sdk',
      limit: 2,
    },
  })

  assert.equal(history.projectionMode, 'shadow')
  assert.equal(history.summary.totalMatching, 2)
  assert.equal(history.summary.returned, 2)
  assert.equal(history.summary.bySource.sdk, 2)
  assert.equal(history.summary.byStatus.failed, 1)
  assert.equal(history.summary.byStatus.approval_pending, 1)
  assert.deepEqual(
    history.actionRequests.map((record) => record.actionRequestId),
    ['action_request_3', 'action_request_1'],
  )
  assert.equal(history.actionRequests[0]?.runtime.runId, 'run_alpha')
  assert.equal(history.actionRequests[0]?.errorCode, 'quote_expired')
})

test('buildDashboardActionRequestDetail returns native transfer detail with runtime and agent context', async () => {
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'action_request_transfer_detail',
      kind: 'asset.transfer',
      status: 'waiting_for_execution',
      title: 'Treasury transfer',
      summary: 'Move 3 PUSD to treasury destination.',
      target: {
        kind: 'address',
        address: 'treasury_destination',
        chainId: 'solana-mainnet',
        counterpartyId: 'treasury_ops',
      },
      value: {
        assetSymbol: 'PUSD',
        amount: '3',
        chainId: 'solana-mainnet',
      },
      requestPayload: {
        destinationAddress: 'treasury_destination',
        chainId: 'solana-mainnet',
        assetSymbol: 'PUSD',
        amount: '3',
      },
      requestContext: {
        nativeActionRequest: true,
        intakeStage: 'waiting_for_execution',
      },
      policy: {
        approvalRequired: false,
        limitsApplied: {
          effectiveMaxTransferAmount: '25.00',
          transferDecisionStatus: 'allowed',
        },
      },
      executionPlan: {
        connectorKind: 'direct',
        settlementAsset: 'PUSD',
        privacyMode: 'off',
        executionMode: 'connector',
      },
      runtimeRefs: {
        sessionId: 'session_alpha',
        runId: 'run_transfer_alpha',
        intentIds: ['intent_transfer_alpha'],
        simulationRefs: ['simulation_alpha'],
      },
    }),
  ])
  const runRegistry = new InMemoryRunRegistry()
  const dashboardAuditLogRegistry = new InMemoryDashboardAuditLogRegistry([
    {
      auditLogId: 'dashboard_audit_transfer_approval',
      at: '2026-06-04T10:16:00.000Z',
      workspaceId: 'workspace_alpha',
      actorId: 'operator_alpha',
      operatorId: 'operator_alpha',
      operatorRole: 'operator',
      source: 'env',
      action: 'approval.decide',
      status: 'succeeded',
      target: {
        type: 'action_request',
        id: 'action_request_transfer_detail',
      },
      summary: 'Approved asset transfer action request action_request_transfer_detail.',
      metadata: {
        decision: 'approve',
        resultKind: 'waiting_for_execution',
        actionRequestKind: 'asset.transfer',
      },
    },
    {
      auditLogId: 'dashboard_audit_other',
      at: '2026-06-04T10:17:00.000Z',
      workspaceId: 'workspace_alpha',
      actorId: 'operator_alpha',
      operatorId: 'operator_alpha',
      operatorRole: 'operator',
      source: 'env',
      action: 'approval.decide',
      status: 'succeeded',
      target: {
        type: 'action_request',
        id: 'action_request_other',
      },
      summary: 'Approved another request.',
    },
  ])
  await runRegistry.put({
    runId: 'run_transfer_alpha',
    sessionId: 'session_alpha',
    actionType: 'asset.transfer',
    status: 'waiting_for_signature',
    currentPhase: 'signing',
    simulationRefs: ['simulation_alpha'],
    signatureRequestRefs: ['signature_alpha'],
    signatureResultRefs: [],
    broadcastRefs: [],
    simulationArtifactPaths: [],
    signatureRequestArtifactPaths: [],
    signatureResultArtifactPaths: [],
    broadcastArtifactPaths: [],
    lastUpdatedAt: '2026-06-04T10:15:00.000Z',
  })

  const detail = await buildDashboardActionRequestDetail({
    workspace: {
      storageDriver: 'postgres',
      actionRequestRegistry: actionRequests,
      agentRegistry: new InMemoryAgentRegistry([createAgent()]),
      runRegistry,
      dashboardAuditLogRegistry,
    } as never,
    actionRequestId: 'action_request_transfer_detail',
  })

  assert.ok(detail)
  assert.equal(detail?.projectionMode, 'transactional_mirror')
  assert.equal(detail?.actionRequest.kind, 'asset.transfer')
  assert.equal(detail?.agent?.displayName, 'Alpha Agent')
  assert.equal(detail?.runtime?.found, true)
  assert.equal(detail?.runtime?.status, 'waiting_for_signature')
  assert.equal(detail?.runtime?.refs.signatureRequestRefs[0], 'signature_alpha')
  assert.equal(detail?.compatibility.derivedFromLegacyPaidCall, false)
  assert.equal(detail?.auditTrail.length, 1)
  assert.equal(detail?.auditTrail[0]?.action, 'approval.decide')
  assert.equal(detail?.auditTrail[0]?.metadata?.resultKind, 'waiting_for_execution')
})

test('buildDashboardWalletActionHistory normalizes native wallet actions', async () => {
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'action_request_service_legacy',
      kind: 'service.pay',
      status: 'executed',
      updatedAt: '2026-06-04T12:00:00.000Z',
      target: {
        kind: 'service',
        serviceId: 'service.launch.audit',
        vendorId: 'vendor_launch',
      },
    }),
    createActionRequest({
      actionRequestId: 'action_request_transfer_wallet',
      kind: 'asset.transfer',
      status: 'waiting_for_execution',
      updatedAt: '2026-06-04T12:05:00.000Z',
      walletId: 'wallet_alpha',
      target: {
        kind: 'address',
        address: 'treasury_destination',
        chainId: 'solana-mainnet',
        counterpartyId: 'treasury_ops',
      },
      value: {
        assetSymbol: 'PUSD',
        amount: '3',
        chainId: 'solana-mainnet',
      },
      policy: {
        approvalRequired: true,
        approvalReason: 'policy.transfer_approval_required',
      },
      executionPlan: {
        connectorKind: 'direct',
        connectorId: 'direct_wallet',
        privacyMode: 'off',
        executionMode: 'connector',
      },
      runtimeRefs: {
        sessionId: 'session_alpha',
        runId: 'run_transfer_alpha',
        intentIds: ['intent_transfer_alpha'],
        simulationRefs: ['simulation_transfer_alpha'],
        broadcastRefs: ['broadcast_transfer_alpha'],
      },
      resultRef: 'signature_transfer_alpha',
    }),
    createActionRequest({
      actionRequestId: 'action_request_policy_wallet',
      kind: 'wallet.policy_update',
      status: 'executed',
      updatedAt: '2026-06-04T12:10:00.000Z',
      walletId: 'wallet_alpha',
      target: {
        kind: 'wallet',
        walletId: 'wallet_alpha',
        chainId: 'solana-mainnet',
      },
      value: undefined,
      title: 'Update wallet policy',
      summary: 'Updated wallet policy limits.',
      policy: {
        approvalRequired: false,
      },
      executionPlan: {
        connectorKind: 'direct',
        privacyMode: 'off',
        executionMode: 'connector',
      },
    }),
  ])

  const history = await buildDashboardWalletActionHistory({
    workspace: {
      storageDriver: 'postgres',
      actionRequestRegistry: actionRequests,
    } as never,
    query: {
      agentId: 'agent_alpha',
      limit: 10,
    },
  })

  assert.equal(history.projectionMode, 'transactional_mirror')
  assert.equal(history.summary.totalMatching, 2)
  assert.equal(history.summary.byKind['service.pay'], undefined)
  assert.equal(history.summary.byKind['asset.transfer'], 1)
  assert.equal(history.summary.byKind['wallet.policy_update'], 1)
  assert.deepEqual(
    history.walletActions.map((record) => record.walletActionId),
    ['action_request_policy_wallet', 'action_request_transfer_wallet'],
  )
  assert.equal(history.walletActions[1]?.approval.required, true)
  assert.equal(history.walletActions[1]?.execution.runId, 'run_transfer_alpha')
  assert.equal(
    history.walletActions[1]?.execution.transactionRef,
    'signature_transfer_alpha',
  )
})

test('dashboard action request route requires access and returns filtered history', async () => {
  const token = operatorSessionToken({ role: 'operator' })
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'action_request_dashboard_1',
      updatedAt: '2026-06-04T13:05:00.000Z',
      source: 'sdk',
      status: 'executed',
      kind: 'asset.transfer',
      policy: {
        approvalRequired: false,
      },
    }),
    createActionRequest({
      actionRequestId: 'action_request_dashboard_2',
      updatedAt: '2026-06-04T13:10:00.000Z',
      source: 'worker',
      status: 'failed',
      kind: 'service.pay',
      errorCode: 'connector_failed',
      errorMessage: 'Connector execution failed.',
    }),
  ])

  const app = express()
  registerActionRequestRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      workspace: {
        storageDriver: 'postgres',
        actionRequestRegistry: actionRequests,
      },
    } as never,
  )
  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/action-requests',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const deniedResponse = createMockResponse()
  await handler(
    {
      headers: {},
      query: {},
      method: 'GET',
      path: '/api/dashboard/action-requests',
    } as never,
    deniedResponse.res as never,
  )
  assert.equal(deniedResponse.read().statusCode, 401)

  const allowedResponse = createMockResponse()
  await handler(
    {
      headers: {
        cookie: `palmos_operator_session=${encodeURIComponent(token)}`,
      },
      query: {
        source: 'worker',
        limit: '1',
      },
      method: 'GET',
      path: '/api/dashboard/action-requests',
    } as never,
    allowedResponse.res as never,
  )

  const result = allowedResponse.read()
  assert.equal(result.statusCode, 200)
  const body = result.body as {
    ok: boolean
    projectionMode: string
    summary: { totalMatching: number; returned: number }
    actionRequests: Array<{
      actionRequestId: string
      source: string
      errorCode?: string
    }>
  }

  assert.equal(body.ok, true)
  assert.equal(body.projectionMode, 'transactional_mirror')
  assert.equal(body.summary.totalMatching, 1)
  assert.equal(body.summary.returned, 1)
  assert.equal(body.actionRequests.length, 1)
  assert.equal(
    body.actionRequests[0]?.actionRequestId,
    'action_request_dashboard_2',
  )
  assert.equal(body.actionRequests[0]?.source, 'worker')
  assert.equal(body.actionRequests[0]?.errorCode, 'connector_failed')
})

test('dashboard wallet action route requires access and returns native wallet actions', async () => {
  const token = operatorSessionToken({ role: 'operator' })
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'action_request_wallet_action_1',
      kind: 'asset.transfer',
      status: 'executed',
      target: {
        kind: 'address',
        address: 'treasury_destination',
        chainId: 'solana-mainnet',
      },
      policy: {
        approvalRequired: false,
      },
    }),
    createActionRequest({
      actionRequestId: 'action_request_paid_call_legacy',
      kind: 'service.pay',
      status: 'executed',
      target: {
        kind: 'service',
        serviceId: 'service.launch.audit',
        vendorId: 'vendor_launch',
      },
      policy: {
        approvalRequired: false,
      },
    }),
  ])

  const app = express()
  registerWalletActionRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      workspace: {
        storageDriver: 'file',
        actionRequestRegistry: actionRequests,
      },
    } as never,
  )
  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/wallet-actions',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const deniedResponse = createMockResponse()
  await handler(
    {
      headers: {},
      query: {},
      method: 'GET',
      path: '/api/dashboard/wallet-actions',
    } as never,
    deniedResponse.res as never,
  )
  assert.equal(deniedResponse.read().statusCode, 401)

  const allowedResponse = createMockResponse()
  await handler(
    {
      headers: {
        cookie: `palmos_operator_session=${encodeURIComponent(token)}`,
      },
      query: {
        agentId: 'agent_alpha',
      },
      method: 'GET',
      path: '/api/dashboard/wallet-actions',
    } as never,
    allowedResponse.res as never,
  )
  const result = allowedResponse.read()
  assert.equal(result.statusCode, 200)
  const body = result.body as {
    ok: boolean
    walletActions: Array<{
      actionRequestId: string
      kind: string
    }>
    summary: {
      totalMatching: number
    }
  }
  assert.equal(body.ok, true)
  assert.equal(body.summary.totalMatching, 1)
  assert.equal(body.walletActions[0]?.actionRequestId, 'action_request_wallet_action_1')
  assert.equal(body.walletActions[0]?.kind, 'asset.transfer')
})

test('dashboard action request detail route requires access and returns detail', async () => {
  const token = operatorSessionToken({ role: 'operator' })
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'action_request_dashboard_detail',
      kind: 'asset.transfer',
      status: 'executed',
      target: {
        kind: 'address',
        address: 'vault_destination',
        chainId: 'solana-mainnet',
        counterpartyId: 'vault_ops',
      },
      requestContext: {
        nativeActionRequest: true,
      },
      runtimeRefs: {
        sessionId: 'session_alpha',
        runId: 'run_alpha_detail',
        intentIds: ['intent_alpha'],
      },
      resultRef: 'report_alpha_detail',
    }),
  ])
  const runRegistry = new InMemoryRunRegistry()
  await runRegistry.put({
    runId: 'run_alpha_detail',
    sessionId: 'session_alpha',
    actionType: 'asset.transfer',
    status: 'completed',
    currentPhase: 'completed',
    simulationRefs: [],
    signatureRequestRefs: ['signature_alpha_detail'],
    signatureResultRefs: ['signature_alpha_detail'],
    broadcastRefs: ['broadcast_alpha_detail'],
    simulationArtifactPaths: [],
    signatureRequestArtifactPaths: [],
    signatureResultArtifactPaths: [],
    broadcastArtifactPaths: [],
    reportRef: 'report_alpha_detail',
    lastUpdatedAt: '2026-06-04T13:20:00.000Z',
  })

  const app = express()
  registerActionRequestRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      workspace: {
        storageDriver: 'file',
        actionRequestRegistry: actionRequests,
        agentRegistry: new InMemoryAgentRegistry([createAgent()]),
        runRegistry,
      },
    } as never,
  )
  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/action-requests/:actionRequestId',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const deniedResponse = createMockResponse()
  await handler(
    {
      headers: {},
      params: {
        actionRequestId: 'action_request_dashboard_detail',
      },
      method: 'GET',
      path: '/api/dashboard/action-requests/action_request_dashboard_detail',
    } as never,
    deniedResponse.res as never,
  )
  assert.equal(deniedResponse.read().statusCode, 401)

  const allowedResponse = createMockResponse()
  await handler(
    {
      headers: {
        cookie: `palmos_operator_session=${encodeURIComponent(token)}`,
      },
      params: {
        actionRequestId: 'action_request_dashboard_detail',
      },
      method: 'GET',
      path: '/api/dashboard/action-requests/action_request_dashboard_detail',
    } as never,
    allowedResponse.res as never,
  )
  const allowed = allowedResponse.read()
  assert.equal(allowed.statusCode, 200)
  const body = allowed.body as {
    ok: boolean
    projectionMode: string
    actionRequest: {
      actionRequestId: string
      kind: string
      status: string
    }
    runtime: {
      found: boolean
      status?: string
      reportRef?: string
    }
  }
  assert.equal(body.ok, true)
  assert.equal(body.projectionMode, 'shadow')
  assert.equal(body.actionRequest.actionRequestId, 'action_request_dashboard_detail')
  assert.equal(body.actionRequest.kind, 'asset.transfer')
  assert.equal(body.runtime.found, true)
  assert.equal(body.runtime.status, 'completed')
  assert.equal(body.runtime.reportRef, 'report_alpha_detail')

  const missingResponse = createMockResponse()
  await handler(
    {
      headers: {
        cookie: `palmos_operator_session=${encodeURIComponent(token)}`,
      },
      params: {
        actionRequestId: 'missing_action_request',
      },
      method: 'GET',
      path: '/api/dashboard/action-requests/missing_action_request',
    } as never,
    missingResponse.res as never,
  )
  const missing = missingResponse.read()
  assert.equal(missing.statusCode, 404)
})

test('buildDashboardWalletActionDetail returns native asset transfer detail with refs and audit trail', async () => {
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'wallet_action_transfer_detail',
      kind: 'asset.transfer',
      status: 'waiting_for_execution',
      walletId: 'wallet_alpha',
      title: 'Treasury transfer',
      summary: 'Move 3 PUSD to treasury destination.',
      target: {
        kind: 'address',
        address: 'treasury_destination',
        chainId: 'solana-mainnet',
        counterpartyId: 'treasury_ops',
      },
      value: {
        assetSymbol: 'PUSD',
        amount: '3',
        chainId: 'solana-mainnet',
      },
      requestContext: {
        nativeActionRequest: true,
      },
      policy: {
        approvalRequired: true,
        approvalReason: 'policy.transfer_approval_required',
      },
      executionPlan: {
        connectorKind: 'direct',
        connectorId: 'direct_wallet',
        privacyMode: 'off',
        executionMode: 'connector',
      },
      runtimeRefs: {
        sessionId: 'session_alpha',
        runId: 'run_transfer_detail',
        intentIds: ['intent_transfer_detail'],
        simulationRefs: ['simulation_transfer_detail'],
        broadcastRefs: ['broadcast_transfer_detail'],
      },
      resultRef: 'signature_transfer_detail',
    }),
    createActionRequest({
      actionRequestId: 'wallet_action_service_legacy',
      kind: 'service.pay',
      status: 'executed',
      target: {
        kind: 'service',
        serviceId: 'service.launch.audit',
        vendorId: 'vendor_launch',
      },
    }),
  ])
  const runRegistry = new InMemoryRunRegistry()
  await runRegistry.put({
    runId: 'run_transfer_detail',
    sessionId: 'session_alpha',
    actionType: 'asset.transfer',
    status: 'waiting_for_signature',
    currentPhase: 'signing',
    simulationRefs: ['simulation_transfer_detail'],
    signatureRequestRefs: ['signature_request_detail'],
    signatureResultRefs: [],
    broadcastRefs: [],
    simulationArtifactPaths: [],
    signatureRequestArtifactPaths: [],
    signatureResultArtifactPaths: [],
    broadcastArtifactPaths: [],
    lastUpdatedAt: '2026-06-04T10:15:00.000Z',
  })
  const dashboardAuditLogRegistry = new InMemoryDashboardAuditLogRegistry([
    {
      auditLogId: 'dashboard_audit_wallet_action_detail',
      at: '2026-06-04T10:16:00.000Z',
      workspaceId: 'workspace_alpha',
      actorId: 'operator_alpha',
      operatorId: 'operator_alpha',
      operatorRole: 'operator',
      source: 'env',
      action: 'approval.decide',
      status: 'succeeded',
      target: {
        type: 'action_request',
        id: 'wallet_action_transfer_detail',
      },
      summary: 'Approved asset transfer action request wallet_action_transfer_detail.',
      metadata: {
        decision: 'approve',
        actionRequestKind: 'asset.transfer',
      },
    },
  ])

  const detail = await buildDashboardWalletActionDetail({
    workspace: {
      storageDriver: 'postgres',
      actionRequestRegistry: actionRequests,
      agentRegistry: new InMemoryAgentRegistry([createAgent()]),
      walletRegistry: new InMemoryWalletRegistry([createWallet()]),
      runRegistry,
      dashboardAuditLogRegistry,
      controlEventRegistry: new InMemoryAgentControlEventRegistry(),
    } as never,
    walletActionId: 'wallet_action_transfer_detail',
  })

  assert.ok(detail)
  assert.equal(detail?.projectionMode, 'transactional_mirror')
  assert.equal(detail?.walletAction.walletActionId, 'wallet_action_transfer_detail')
  assert.equal(detail?.walletAction.kind, 'asset.transfer')
  assert.equal(detail?.walletAction.approval.required, true)
  assert.equal(
    detail?.walletAction.execution.transactionRef,
    'signature_transfer_detail',
  )
  // actionRequest detail is reused, carrying runtime refs and audit trail.
  assert.equal(detail?.actionRequest?.actionRequest.kind, 'asset.transfer')
  assert.equal(detail?.actionRequest?.runtime?.found, true)
  assert.equal(detail?.actionRequest?.runtime?.status, 'waiting_for_signature')
  assert.equal(
    detail?.actionRequest?.runtime?.refs.signatureRequestRefs[0],
    'signature_request_detail',
  )
  assert.equal(detail?.actionRequest?.auditTrail.length, 1)
  assert.equal(detail?.actionRequest?.auditTrail[0]?.action, 'approval.decide')
  // agent + wallet summaries.
  assert.equal(detail?.agent?.displayName, 'Alpha Agent')
  assert.equal(detail?.wallet?.walletId, 'wallet_alpha')
  assert.equal(detail?.wallet?.address, 'AlphaWallet111')
  // wallet-cycle summary is included for the agent/wallet.
  assert.equal(detail?.walletCycle?.wallet.walletId, 'wallet_alpha')
  // provenance.
  assert.equal(detail?.provenance.nativeActionRequest, true)
  assert.equal(detail?.provenance.legacyPaidCallDerived, false)
  assert.equal(
    detail?.provenance.sourceActionRequestId,
    'wallet_action_transfer_detail',
  )
})

test('buildDashboardWalletActionDetail returns undefined for legacy service.pay and missing ids', async () => {
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'wallet_action_service_only',
      kind: 'service.pay',
      status: 'executed',
      target: {
        kind: 'service',
        serviceId: 'service.launch.audit',
        vendorId: 'vendor_launch',
      },
    }),
  ])

  const workspace = {
    storageDriver: 'file',
    actionRequestRegistry: actionRequests,
    agentRegistry: new InMemoryAgentRegistry([createAgent()]),
    walletRegistry: new InMemoryWalletRegistry([createWallet()]),
    runRegistry: new InMemoryRunRegistry(),
    dashboardAuditLogRegistry: new InMemoryDashboardAuditLogRegistry(),
    controlEventRegistry: new InMemoryAgentControlEventRegistry(),
  } as never

  const legacy = await buildDashboardWalletActionDetail({
    workspace,
    walletActionId: 'wallet_action_service_only',
  })
  assert.equal(legacy, undefined)

  const missing = await buildDashboardWalletActionDetail({
    workspace,
    walletActionId: 'wallet_action_missing',
  })
  assert.equal(missing, undefined)
})

test('dashboard wallet action detail route requires access and returns native detail with 404s', async () => {
  const token = operatorSessionToken({ role: 'operator' })
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'wallet_action_route_native',
      kind: 'asset.transfer',
      status: 'executed',
      walletId: 'wallet_alpha',
      target: {
        kind: 'address',
        address: 'treasury_destination',
        chainId: 'solana-mainnet',
      },
      policy: {
        approvalRequired: false,
      },
      runtimeRefs: {
        sessionId: 'session_alpha',
        runId: 'run_route_native',
        intentIds: ['intent_route_native'],
      },
      resultRef: 'signature_route_native',
    }),
    createActionRequest({
      actionRequestId: 'wallet_action_route_service',
      kind: 'service.pay',
      status: 'executed',
      target: {
        kind: 'service',
        serviceId: 'service.launch.audit',
        vendorId: 'vendor_launch',
      },
      policy: {
        approvalRequired: false,
      },
    }),
  ])

  const app = express()
  registerWalletActionRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      workspace: {
        storageDriver: 'postgres',
        actionRequestRegistry: actionRequests,
        agentRegistry: new InMemoryAgentRegistry([createAgent()]),
        walletRegistry: new InMemoryWalletRegistry([createWallet()]),
        runRegistry: new InMemoryRunRegistry(),
        dashboardAuditLogRegistry: new InMemoryDashboardAuditLogRegistry(),
        controlEventRegistry: new InMemoryAgentControlEventRegistry(),
      },
    } as never,
  )
  const layer = app.router.stack.find(
    (entry) =>
      entry.route?.path === '/api/dashboard/wallet-actions/:walletActionId',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const deniedResponse = createMockResponse()
  await handler(
    {
      headers: {},
      params: { walletActionId: 'wallet_action_route_native' },
      method: 'GET',
      path: '/api/dashboard/wallet-actions/wallet_action_route_native',
    } as never,
    deniedResponse.res as never,
  )
  assert.equal(deniedResponse.read().statusCode, 401)

  const allowedResponse = createMockResponse()
  await handler(
    {
      headers: {
        cookie: `palmos_operator_session=${encodeURIComponent(token)}`,
      },
      params: { walletActionId: 'wallet_action_route_native' },
      method: 'GET',
      path: '/api/dashboard/wallet-actions/wallet_action_route_native',
    } as never,
    allowedResponse.res as never,
  )
  const allowed = allowedResponse.read()
  assert.equal(allowed.statusCode, 200)
  const body = allowed.body as {
    ok: boolean
    walletAction: { walletActionId: string; kind: string }
    provenance: { nativeActionRequest: boolean; sourceActionRequestId: string }
  }
  assert.equal(body.ok, true)
  assert.equal(body.walletAction.walletActionId, 'wallet_action_route_native')
  assert.equal(body.walletAction.kind, 'asset.transfer')
  assert.equal(body.provenance.nativeActionRequest, true)

  const serviceResponse = createMockResponse()
  await handler(
    {
      headers: {
        cookie: `palmos_operator_session=${encodeURIComponent(token)}`,
      },
      params: { walletActionId: 'wallet_action_route_service' },
      method: 'GET',
      path: '/api/dashboard/wallet-actions/wallet_action_route_service',
    } as never,
    serviceResponse.res as never,
  )
  assert.equal(serviceResponse.read().statusCode, 404)

  const missingResponse = createMockResponse()
  await handler(
    {
      headers: {
        cookie: `palmos_operator_session=${encodeURIComponent(token)}`,
      },
      params: { walletActionId: 'wallet_action_route_missing' },
      method: 'GET',
      path: '/api/dashboard/wallet-actions/wallet_action_route_missing',
    } as never,
    missingResponse.res as never,
  )
  assert.equal(missingResponse.read().statusCode, 404)
})

test('buildDashboardTransactions combines legacy paid calls and native wallet actions without duplication', async () => {
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'tx_wallet_create',
      kind: 'wallet.create',
      status: 'executed',
      updatedAt: '2026-06-04T12:00:00.000Z',
      walletId: 'wallet_alpha',
      target: { kind: 'wallet', walletId: 'wallet_alpha', chainId: 'solana-mainnet' },
      value: undefined,
      title: 'Create ops wallet',
      summary: 'Provisioned ops wallet.',
      policy: { approvalRequired: false },
    }),
    createActionRequest({
      actionRequestId: 'tx_policy_update',
      kind: 'wallet.policy_update',
      status: 'executed',
      updatedAt: '2026-06-04T12:05:00.000Z',
      walletId: 'wallet_alpha',
      target: { kind: 'wallet', walletId: 'wallet_alpha', chainId: 'solana-mainnet' },
      value: undefined,
      title: 'Update wallet policy',
      summary: 'Attached transfer policy.',
      policy: { approvalRequired: false },
    }),
    createActionRequest({
      actionRequestId: 'tx_asset_transfer',
      kind: 'asset.transfer',
      status: 'waiting_for_execution',
      updatedAt: '2026-06-04T12:10:00.000Z',
      walletId: 'wallet_alpha',
      target: {
        kind: 'address',
        address: 'treasury_destination',
        chainId: 'solana-mainnet',
      },
      value: { assetSymbol: 'PUSD', amount: '3', chainId: 'solana-mainnet' },
      policy: {
        approvalRequired: true,
        approvalReason: 'policy.transfer_approval_required',
      },
      runtimeRefs: {
        sessionId: 'session_alpha',
        runId: 'run_tx_transfer',
        intentIds: ['intent_tx_transfer'],
      },
      resultRef: 'signature_tx_transfer',
    }),
  ])
  // Paid calls mirror into the same ActionRequest registry as service.pay rows;
  // they must surface exactly once as legacy rows, never as native rows.
  const paidCallRegistry = new InMemoryPaidCallRegistry([], actionRequests)
  await paidCallRegistry.put(
    createPaidCall({
      executionId: 'tx_paid_call_1',
      updatedAt: '2026-06-04T12:02:00.000Z',
      serviceId: 'service.spot.price',
    }),
  )
  await paidCallRegistry.put(
    createPaidCall({
      executionId: 'tx_paid_call_2',
      updatedAt: '2026-06-04T12:20:00.000Z',
      serviceId: 'service.launch.audit',
      status: 'failed',
      errorCode: 'connector_failed',
      errorMessage: 'Connector execution failed.',
    }),
  )

  const transactions = await buildDashboardTransactions({
    workspace: {
      storageDriver: 'postgres',
      actionRequestRegistry: actionRequests,
      paidCallRegistry,
    } as never,
    query: { agentId: 'agent_alpha', limit: 20 },
  })

  assert.equal(transactions.projectionMode, 'transactional_mirror')
  assert.equal(transactions.summary.totalMatching, 5)
  assert.equal(transactions.summary.returned, 5)
  assert.equal(transactions.summary.byTransactionKind.legacy_paid_call, 2)
  assert.equal(transactions.summary.byTransactionKind.native_wallet_action, 3)
  assert.equal(transactions.summary.byActionRequestKind['wallet.create'], 1)
  assert.equal(transactions.summary.byActionRequestKind['wallet.policy_update'], 1)
  assert.equal(transactions.summary.byActionRequestKind['asset.transfer'], 1)
  // byStatus spans both sources; byLegacySettlementMode is scoped to paid calls.
  assert.equal(transactions.summary.byStatus['executed'], 3)
  assert.equal(transactions.summary.byStatus['waiting_for_execution'], 1)
  assert.equal(transactions.summary.byStatus['failed'], 1)
  assert.equal(transactions.summary.byLegacySettlementMode['ows'], 2)

  // No duplicate ids across native + legacy rows.
  const ids = transactions.transactions.map((row) => row.id)
  assert.equal(new Set(ids).size, ids.length)

  // Ordering is by updated time (desc), most recent first.
  assert.deepEqual(ids, [
    'tx_paid_call_2',
    'tx_asset_transfer',
    'tx_policy_update',
    'tx_paid_call_1',
    'tx_wallet_create',
  ])

  const nativeTransfer = transactions.transactions.find(
    (row) => row.id === 'tx_asset_transfer',
  )
  assert.ok(nativeTransfer)
  assert.equal(nativeTransfer?.transactionKind, 'native_wallet_action')
  if (nativeTransfer?.transactionKind === 'native_wallet_action') {
    assert.equal(nativeTransfer.actionRequestKind, 'asset.transfer')
    assert.equal(nativeTransfer.walletActionId, 'tx_asset_transfer')
    assert.equal(nativeTransfer.walletId, 'wallet_alpha')
    assert.equal(nativeTransfer.approval.required, true)
    assert.equal(nativeTransfer.transactionRef, 'signature_tx_transfer')
    assert.equal(nativeTransfer.runtime.runId, 'run_tx_transfer')
    assert.equal(nativeTransfer.value?.amount, '3')
  }

  const legacyRow = transactions.transactions.find(
    (row) => row.id === 'tx_paid_call_2',
  )
  assert.ok(legacyRow)
  assert.equal(legacyRow?.transactionKind, 'legacy_paid_call')
  if (legacyRow?.transactionKind === 'legacy_paid_call') {
    // Existing paid-call compatibility fields stay stable and explicit.
    assert.equal(legacyRow.legacy.serviceId, 'service.launch.audit')
    assert.equal(legacyRow.legacy.vendorId, 'vendor_launch')
    assert.equal(legacyRow.legacy.paymentRail, 'palmos-pusd')
    assert.equal(legacyRow.legacy.amount, '0.25')
    assert.equal(legacyRow.status, 'failed')
    assert.equal(legacyRow.legacy.errorCode, 'connector_failed')
    assert.equal(legacyRow.value?.assetSymbol, 'PUSD')
  }
})

test('buildDashboardTransactions includes live deposit agent events from the portfolio reader', async () => {
  const actionRequests = new InMemoryActionRequestRegistry([])
  const portfolioReader: PortfolioReader = {
    async getWalletSnapshot(address, options): Promise<WalletPortfolioSnapshot> {
      assert.equal(address, 'AlphaWallet111')
      assert.equal(options?.chainId, 'solana-mainnet')
      return {
        address,
        positions: [],
        transactions: [
          {
            id: 'sig_usdc_credit',
            hash: 'sig_usdc_credit',
            chainId: 'solana-mainnet',
            minedAt: '2026-06-12T22:03:19.000Z',
            operationType: 'deposit',
            direction: 'in',
            assetSymbol: 'USDC',
            amount: 20,
          },
        ],
        valuationComplete: true,
        sync: {
          kind: 'synced',
          chainId: 'solana-mainnet',
          message: 'Synced.',
        },
      }
    },
  }

  const transactions = await buildDashboardTransactions({
    workspace: {
      storageDriver: 'postgres',
      actionRequestRegistry: actionRequests,
      paidCallRegistry: new InMemoryPaidCallRegistry([], actionRequests),
      agentRegistry: new InMemoryAgentRegistry([
        createAgent({ displayName: 'Main', walletId: 'wallet_alpha' }),
      ]),
      walletRegistry: new InMemoryWalletRegistry([createWallet()]),
    } as never,
    portfolioReader,
    query: { transactionKind: 'agent_event', limit: 10 },
  })

  assert.equal(transactions.summary.totalMatching, 1)
  assert.equal(transactions.summary.byTransactionKind.agent_event, 1)
  const [event] = transactions.transactions
  assert.ok(event)
  assert.equal(event?.transactionKind, 'agent_event')
  if (event?.transactionKind === 'agent_event') {
    assert.equal(event.id, 'deposit:agent_alpha:sig_usdc_credit')
    assert.equal(event.eventType, 'deposit.detected')
    assert.equal(event.title, 'Funding detected')
    assert.equal(event.createdAt, '2026-06-12T22:03:19.000Z')
    assert.equal(event.summary, 'Main received 20 USDC on-chain.')
  }
})

type TransactionRouteHandler = (req: never, res: never) => Promise<void>

async function createTransactionsRouteHandler(): Promise<{
  token: string
  handler: TransactionRouteHandler
}> {
  const token = operatorSessionToken({ role: 'operator' })
  // Two agents / two wallets, mixed native + legacy, distinct updatedAt values
  // so ordering is unambiguous.
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'native_alpha_transfer',
      kind: 'asset.transfer',
      status: 'executed',
      updatedAt: '2026-06-04T12:30:00.000Z',
      agentId: 'agent_alpha',
      walletId: 'wallet_alpha',
      target: {
        kind: 'address',
        address: 'dest_alpha',
        chainId: 'solana-mainnet',
      },
      value: { assetSymbol: 'PUSD', amount: '3', chainId: 'solana-mainnet' },
      policy: { approvalRequired: false },
    }),
    createActionRequest({
      actionRequestId: 'native_alpha_create',
      kind: 'wallet.create',
      status: 'executed',
      updatedAt: '2026-06-04T12:00:00.000Z',
      agentId: 'agent_alpha',
      walletId: 'wallet_alpha',
      target: { kind: 'wallet', walletId: 'wallet_alpha', chainId: 'solana-mainnet' },
      value: undefined,
      title: 'Create ops wallet',
      summary: 'Provisioned ops wallet.',
      policy: { approvalRequired: false },
    }),
    createActionRequest({
      actionRequestId: 'native_beta_transfer',
      kind: 'asset.transfer',
      status: 'executed',
      updatedAt: '2026-06-04T12:20:00.000Z',
      agentId: 'agent_beta',
      walletId: 'wallet_beta',
      target: {
        kind: 'address',
        address: 'dest_beta',
        chainId: 'solana-mainnet',
      },
      value: { assetSymbol: 'PUSD', amount: '5', chainId: 'solana-mainnet' },
      policy: { approvalRequired: false },
    }),
  ])
  const paidCallRegistry = new InMemoryPaidCallRegistry([], actionRequests)
  await paidCallRegistry.put(
    createPaidCall({
      executionId: 'paid_alpha',
      agentId: 'agent_alpha',
      walletId: 'wallet_alpha',
      updatedAt: '2026-06-04T12:10:00.000Z',
    }),
  )
  await paidCallRegistry.put(
    createPaidCall({
      executionId: 'paid_beta',
      agentId: 'agent_beta',
      walletId: 'wallet_beta',
      updatedAt: '2026-06-04T12:05:00.000Z',
    }),
  )

  const app = express()
  registerTransactionRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      workspace: {
        storageDriver: 'postgres',
        actionRequestRegistry: actionRequests,
        paidCallRegistry,
      },
    } as never,
  )
  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/transactions',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')
  return { token, handler: handler as TransactionRouteHandler }
}

function transactionsRequest(input: {
  token?: string
  query?: Record<string, string>
}) {
  return {
    headers: input.token
      ? { cookie: `palmos_operator_session=${encodeURIComponent(input.token)}` }
      : {},
    query: input.query ?? {},
    method: 'GET',
    path: '/api/dashboard/transactions',
  } as never
}

type TransactionsRouteBody = {
  ok: boolean
  projectionMode: string
  summary: {
    totalMatching: number
    returned: number
    byTransactionKind: Record<string, number>
    byStatus: Record<string, number>
    byActionRequestKind: Record<string, number>
    byLegacySettlementMode: Record<string, number>
  }
  transactions: Array<{ id: string; transactionKind: string; walletId?: string; agentId: string }>
}

test('dashboard transactions route requires access and returns combined rows newest first', async () => {
  const { token, handler } = await createTransactionsRouteHandler()

  const denied = createMockResponse()
  await handler(transactionsRequest({}), denied.res as never)
  assert.equal(denied.read().statusCode, 401)

  const allowed = createMockResponse()
  await handler(transactionsRequest({ token }), allowed.res as never)
  const result = allowed.read()
  assert.equal(result.statusCode, 200)
  const body = result.body as TransactionsRouteBody

  assert.equal(body.ok, true)
  assert.equal(body.projectionMode, 'transactional_mirror')
  assert.equal(body.summary.totalMatching, 5)
  assert.equal(body.summary.returned, 5)
  assert.equal(body.summary.byTransactionKind.legacy_paid_call, 2)
  assert.equal(body.summary.byTransactionKind.native_wallet_action, 3)
  // Both legacy and native rows present, newest-first by updatedAt.
  assert.deepEqual(
    body.transactions.map((row) => row.id),
    [
      'native_alpha_transfer',
      'native_beta_transfer',
      'paid_alpha',
      'paid_beta',
      'native_alpha_create',
    ],
  )
  assert.deepEqual(
    body.transactions.map((row) => row.transactionKind),
    [
      'native_wallet_action',
      'native_wallet_action',
      'legacy_paid_call',
      'legacy_paid_call',
      'native_wallet_action',
    ],
  )
})

test('dashboard transactions route filters by transactionKind', async () => {
  const { token, handler } = await createTransactionsRouteHandler()

  const nativeOnly = createMockResponse()
  await handler(
    transactionsRequest({ token, query: { transactionKind: 'native_wallet_action' } }),
    nativeOnly.res as never,
  )
  const nativeResult = nativeOnly.read()
  assert.equal(nativeResult.statusCode, 200)
  const nativeBody = nativeResult.body as TransactionsRouteBody
  assert.equal(nativeBody.summary.totalMatching, 3)
  assert.equal(nativeBody.summary.byTransactionKind.legacy_paid_call, 0)
  assert.ok(
    nativeBody.transactions.every(
      (row) => row.transactionKind === 'native_wallet_action',
    ),
  )

  const legacyOnly = createMockResponse()
  await handler(
    transactionsRequest({ token, query: { transactionKind: 'legacy_paid_call' } }),
    legacyOnly.res as never,
  )
  const legacyResult = legacyOnly.read()
  assert.equal(legacyResult.statusCode, 200)
  const legacyBody = legacyResult.body as TransactionsRouteBody
  assert.equal(legacyBody.summary.totalMatching, 2)
  assert.equal(legacyBody.summary.byTransactionKind.native_wallet_action, 0)
  assert.deepEqual(
    legacyBody.transactions.map((row) => row.id),
    ['paid_alpha', 'paid_beta'],
  )
})

test('dashboard transactions route filters by agentId and walletId', async () => {
  const { token, handler } = await createTransactionsRouteHandler()

  const byAgent = createMockResponse()
  await handler(
    transactionsRequest({ token, query: { agentId: 'agent_alpha' } }),
    byAgent.res as never,
  )
  const agentBody = byAgent.read().body as TransactionsRouteBody
  assert.equal(agentBody.summary.totalMatching, 3)
  assert.ok(agentBody.transactions.every((row) => row.agentId === 'agent_alpha'))
  assert.deepEqual(
    agentBody.transactions.map((row) => row.id),
    ['native_alpha_transfer', 'paid_alpha', 'native_alpha_create'],
  )

  const byWallet = createMockResponse()
  await handler(
    transactionsRequest({ token, query: { walletId: 'wallet_beta' } }),
    byWallet.res as never,
  )
  const walletBody = byWallet.read().body as TransactionsRouteBody
  assert.equal(walletBody.summary.totalMatching, 2)
  // Native rows are scoped to the requested wallet.
  const nativeWalletRows = walletBody.transactions.filter(
    (row) => row.transactionKind === 'native_wallet_action',
  )
  assert.deepEqual(
    nativeWalletRows.map((row) => row.id),
    ['native_beta_transfer'],
  )
  assert.ok(walletBody.transactions.every((row) => row.walletId === 'wallet_beta'))
})

test('dashboard transactions route rejects invalid limit and transactionKind', async () => {
  const { token, handler } = await createTransactionsRouteHandler()

  const badLimit = createMockResponse()
  await handler(
    transactionsRequest({ token, query: { limit: '0' } }),
    badLimit.res as never,
  )
  assert.equal(badLimit.read().statusCode, 400)

  const badKind = createMockResponse()
  await handler(
    transactionsRequest({ token, query: { transactionKind: 'bogus_kind' } }),
    badKind.res as never,
  )
  assert.equal(badKind.read().statusCode, 400)
})

function createApprovalsWorkspace() {
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'approval_native_transfer',
      kind: 'asset.transfer',
      status: 'approval_pending',
      updatedAt: '2026-06-04T12:20:00.000Z',
      createdAt: '2026-06-04T12:20:00.000Z',
      agentId: 'agent_alpha',
      walletId: 'wallet_alpha',
      title: 'Treasury transfer',
      summary: 'Move 5 PUSD to treasury destination.',
      target: {
        kind: 'address',
        address: 'treasury_destination',
        chainId: 'solana-mainnet',
        counterpartyId: 'treasury_ops',
      },
      value: { assetSymbol: 'PUSD', amount: '5', chainId: 'solana-mainnet' },
      policy: {
        approvalRequired: true,
        approvalReason: 'policy.transfer_approval_required',
      },
    }),
    createActionRequest({
      actionRequestId: 'approval_native_executed',
      kind: 'asset.transfer',
      status: 'executed',
      updatedAt: '2026-06-04T12:15:00.000Z',
      agentId: 'agent_alpha',
      walletId: 'wallet_alpha',
      target: {
        kind: 'address',
        address: 'treasury_destination',
        chainId: 'solana-mainnet',
      },
      policy: { approvalRequired: true },
    }),
    createActionRequest({
      actionRequestId: 'approval_service_pending',
      kind: 'service.pay',
      status: 'approval_pending',
      updatedAt: '2026-06-04T12:10:00.000Z',
      agentId: 'agent_alpha',
      target: {
        kind: 'service',
        serviceId: 'service.launch.audit',
        vendorId: 'vendor_launch',
      },
      policy: { approvalRequired: true },
    }),
  ])
  const paidCallRegistry = new InMemoryPaidCallRegistry([], actionRequests)
  const xmtpAlertRegistry = new InMemoryXMTPAlertRegistry([
    {
      alertId: 'alert_paid_pending',
      createdAt: '2026-06-04T12:05:30.000Z',
      updatedAt: '2026-06-04T12:05:30.000Z',
      type: 'approval.requested',
      status: 'sent',
      agentId: 'agent_alpha',
      executionId: 'approval_paid_pending',
      messagePreview: 'Approval requested for paid call.',
    },
  ])

  return { actionRequests, paidCallRegistry, xmtpAlertRegistry }
}

test('buildDashboardApprovals merges native and legacy pending approvals with target ids', async () => {
  const { actionRequests, paidCallRegistry, xmtpAlertRegistry } =
    createApprovalsWorkspace()
  await paidCallRegistry.put(
    createPaidCall({
      executionId: 'approval_paid_pending',
      status: 'approval_pending',
      updatedAt: '2026-06-04T12:05:00.000Z',
      createdAt: '2026-06-04T12:05:00.000Z',
      serviceId: 'service.launch.audit',
      vendorId: 'vendor_launch',
      amount: '1.5',
    }),
  )
  await paidCallRegistry.put(
    createPaidCall({
      executionId: 'approval_paid_executed',
      status: 'executed',
      updatedAt: '2026-06-04T12:00:00.000Z',
      serviceId: 'service.launch.audit',
    }),
  )

  const approvals = await buildDashboardApprovals({
    workspace: {
      storageDriver: 'postgres',
      actionRequestRegistry: actionRequests,
      paidCallRegistry,
      xmtpAlertRegistry,
    } as never,
  })

  assert.equal(approvals.projectionMode, 'transactional_mirror')
  assert.equal(approvals.summary.totalPending, 2)
  assert.equal(approvals.summary.byTransactionKind.native_wallet_action, 1)
  assert.equal(approvals.summary.byTransactionKind.legacy_paid_call, 1)
  assert.equal(approvals.summary.byApprovalKind['asset.transfer'], 1)
  assert.equal(approvals.summary.byApprovalKind['paid_call'], 1)

  // Ordering newest-first by createdAt.
  assert.deepEqual(
    approvals.approvals.map((row) => row.id),
    ['approval_native_transfer', 'approval_paid_pending'],
  )

  const native = approvals.approvals.find(
    (row) => row.id === 'approval_native_transfer',
  )
  assert.ok(native)
  assert.equal(native?.transactionKind, 'native_wallet_action')
  assert.equal(native?.approvalKind, 'asset.transfer')
  assert.equal(native?.walletId, 'wallet_alpha')
  assert.equal(native?.amount, '5')
  assert.equal(native?.approval.required, true)
  assert.equal(native?.targets.actionRequestId, 'approval_native_transfer')
  assert.equal(native?.targets.counterpartyId, 'treasury_ops')
  assert.equal(native?.xmtp.requested, false)

  const legacy = approvals.approvals.find(
    (row) => row.id === 'approval_paid_pending',
  )
  assert.ok(legacy)
  assert.equal(legacy?.transactionKind, 'legacy_paid_call')
  assert.equal(legacy?.approvalKind, 'paid_call')
  assert.equal(legacy?.targets.serviceId, 'service.launch.audit')
  assert.equal(legacy?.targets.vendorId, 'vendor_launch')
  assert.equal(legacy?.targets.paymentRail, 'palmos-pusd')
  // XMTP approval.requested alert is joined for legacy paid calls.
  assert.equal(legacy?.xmtp.requested, true)

  // Executed rows and service.pay mirrors are not in the pending queue.
  const ids = approvals.approvals.map((row) => row.id)
  assert.ok(!ids.includes('approval_native_executed'))
  assert.ok(!ids.includes('approval_service_pending'))
  assert.ok(!ids.includes('approval_paid_executed'))
})

test('buildDashboardApprovals includes waiting_for_execution paid calls and filters by agent', async () => {
  const actionRequests = new InMemoryActionRequestRegistry([])
  const paidCallRegistry = new InMemoryPaidCallRegistry([], actionRequests)
  await paidCallRegistry.put(
    createPaidCall({
      executionId: 'approval_waiting_alpha',
      status: 'waiting_for_execution',
      agentId: 'agent_alpha',
      updatedAt: '2026-06-04T12:30:00.000Z',
      createdAt: '2026-06-04T12:30:00.000Z',
    }),
  )
  await paidCallRegistry.put(
    createPaidCall({
      executionId: 'approval_pending_beta',
      status: 'approval_pending',
      agentId: 'agent_beta',
      updatedAt: '2026-06-04T12:31:00.000Z',
      createdAt: '2026-06-04T12:31:00.000Z',
    }),
  )

  const all = await buildDashboardApprovals({
    workspace: {
      storageDriver: 'file',
      actionRequestRegistry: actionRequests,
      paidCallRegistry,
      xmtpAlertRegistry: new InMemoryXMTPAlertRegistry(),
    } as never,
  })
  assert.equal(all.projectionMode, 'shadow')
  assert.equal(all.summary.totalPending, 2)

  const filtered = await buildDashboardApprovals({
    workspace: {
      storageDriver: 'file',
      actionRequestRegistry: actionRequests,
      paidCallRegistry,
      xmtpAlertRegistry: new InMemoryXMTPAlertRegistry(),
    } as never,
    query: { agentId: 'agent_alpha' },
  })
  assert.equal(filtered.summary.totalPending, 1)
  assert.equal(filtered.approvals[0]?.id, 'approval_waiting_alpha')
  assert.equal(filtered.approvals[0]?.status, 'waiting_for_execution')
})

test('dashboard approvals route requires access and returns combined queue', async () => {
  const token = operatorSessionToken({ role: 'operator' })
  const { actionRequests, paidCallRegistry, xmtpAlertRegistry } =
    createApprovalsWorkspace()
  await paidCallRegistry.put(
    createPaidCall({
      executionId: 'approval_paid_pending',
      status: 'approval_pending',
      updatedAt: '2026-06-04T12:05:00.000Z',
      createdAt: '2026-06-04T12:05:00.000Z',
    }),
  )

  const app = express()
  registerApprovalReadRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      workspace: {
        storageDriver: 'postgres',
        actionRequestRegistry: actionRequests,
        paidCallRegistry,
        xmtpAlertRegistry,
      },
    } as never,
  )
  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/approvals',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const denied = createMockResponse()
  await handler(
    { headers: {}, query: {}, method: 'GET', path: '/api/dashboard/approvals' } as never,
    denied.res as never,
  )
  assert.equal(denied.read().statusCode, 401)

  const allowed = createMockResponse()
  await handler(
    {
      headers: {
        cookie: `palmos_operator_session=${encodeURIComponent(token)}`,
      },
      query: {},
      method: 'GET',
      path: '/api/dashboard/approvals',
    } as never,
    allowed.res as never,
  )
  const result = allowed.read()
  assert.equal(result.statusCode, 200)
  const body = result.body as {
    ok: boolean
    summary: { totalPending: number; byTransactionKind: Record<string, number> }
    approvals: Array<{ id: string; transactionKind: string; approvalKind: string }>
  }
  assert.equal(body.ok, true)
  assert.equal(body.summary.totalPending, 2)
  assert.equal(body.summary.byTransactionKind.native_wallet_action, 1)
  assert.equal(body.summary.byTransactionKind.legacy_paid_call, 1)
  assert.equal(body.approvals[0]?.id, 'approval_native_transfer')
})
