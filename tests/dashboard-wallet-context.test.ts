import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import type { WalletRecord } from '../runtime/contracts/wallet.js'
import { InMemoryWalletRegistry } from '../runtime/wallets/WalletRegistry.js'
import { operatorSessionCookie, TEST_SESSION_SECRET } from './helpers/siwsAuth.js'
import { buildDashboardAgentWalletContext } from '../src/server/dashboard/agentWalletContext.js'
import { buildDashboardAgentWalletCycle } from '../src/server/dashboard/agentWalletCycle.js'
import { createDashboardMutationIdempotencyStore } from '../src/server/dashboard/mutationIdempotency.js'
import { registerAgentOnboardingRoutes } from '../src/server/dashboard/routes/agentOnboardingRoutes.js'
import { registerAgentWalletContextRoutes } from '../src/server/dashboard/routes/agentWalletContextRoutes.js'
import { registerAgentWalletCycleRoutes } from '../src/server/dashboard/routes/agentWalletCycleRoutes.js'
import {
  InMemoryActionRequestRegistry,
  type ActionRequestRecord,
} from '../src/store/ActionRequestRegistry.js'
import {
  InMemoryAgentControlEventRegistry,
} from '../src/store/AgentControlEventRegistry.js'
import { InMemoryAgentRegistry, type AgentRecord } from '../src/store/AgentRegistry.js'
import { InMemoryDashboardAuditLogRegistry } from '../src/store/DashboardAuditLogRegistry.js'
import { registerAgentPolicyRoutes } from '../src/server/dashboard/routes/agentPolicyRoutes.js'
import { registerSdkRoutes } from '../src/server/dashboard/routes/sdkRoutes.js'
import { createAgentCredential } from '../src/app/createAgentCredential.js'
import { InMemoryAgentCredentialRegistry } from '../src/store/AgentCredentialRegistry.js'
import { createDashboardOperationalMetricsStore } from '../src/server/dashboard/operationalMetrics.js'

function createAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: 'agent_alpha',
    createdAt: '2026-06-05T10:00:00.000Z',
    updatedAt: '2026-06-05T10:00:00.000Z',
    displayName: 'Alpha Agent',
    organizationId: 'org_alpha',
    treasuryId: 'treasury_alpha',
    environment: 'production',
    actorId: 'agent:agent_alpha',
    sessionId: 'agent:agent_alpha',
    walletType: 'ops',
    settlementMode: 'ows',
    walletId: 'wallet_alpha',
    walletState: 'active_limited',
    signerProfileId: 'signer_alpha',
    policyProfileId: 'policy_alpha',
    walletBackend: 'ows',
    owsWalletId: 'ows_wallet_alpha',
    owsWalletName: 'alpha-ows',
    owsApiKeyId: 'ows_key_alpha',
    owsVaultPath: '/vault/alpha',
    policyConfig: {
      agentId: 'agent_alpha',
      organizationId: 'org_alpha',
      environment: 'production',
      walletType: 'ops',
      allowedChains: ['solana-mainnet'],
      allowedAssets: ['PUSD', 'wSOL'],
      allowedSignerClasses: ['multisig'],
      allowedVendors: [
        {
          vendorId: 'vendor_launch',
          label: 'Launch Auditor',
          destinationAddress: 'Vendor111',
          chainId: 'solana-mainnet',
        },
      ],
      autoApproveUnder: '0.05',
      maxPerTransaction: '2',
      sessionBudget: '5',
      heartbeatTimeoutSeconds: 900,
      umbra: {
        mixerRequired: true,
        defaultPath: 'umbra_mixer_utxo',
        disclosureRecipients: ['ops'],
        viewingKeyRetention: 'artifact_only',
      },
    },
    trustTier: 'healthy',
    status: 'ready',
    lastCheckInAt: '2026-06-05T10:00:00.000Z',
    ...overrides,
  }
}

function createWallet(overrides: Partial<WalletRecord> = {}): WalletRecord {
  return {
    walletId: 'wallet_alpha',
    createdAt: '2026-06-05T10:00:00.000Z',
    updatedAt: '2026-06-05T10:00:00.000Z',
    state: 'active_limited',
    organizationId: 'org_alpha',
    treasuryId: 'treasury_alpha',
    subjectId: 'agent_alpha',
    walletType: 'ops',
    address: 'AlphaWallet111',
    supportedChains: ['solana-mainnet', 'base'],
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

function createActionRequest(
  overrides: Partial<ActionRequestRecord> = {},
): ActionRequestRecord {
  return {
    actionRequestId: 'action_request_wallet_cycle',
    createdAt: '2026-06-05T10:15:00.000Z',
    updatedAt: '2026-06-05T10:15:00.000Z',
    agentId: 'agent_alpha',
    walletId: 'wallet_alpha',
    source: 'sdk',
    kind: 'asset.transfer',
    status: 'executed',
    target: {
      kind: 'address',
      address: 'Counterparty111',
      chainId: 'solana-mainnet',
      counterpartyId: 'counterparty_ops',
    },
    value: {
      assetSymbol: 'PUSD',
      amount: '1.5',
      chainId: 'solana-mainnet',
    },
    title: 'Transfer 1.5 PUSD',
    summary: 'Native wallet transfer.',
    requestPayload: {
      destinationAddress: 'Counterparty111',
      amount: '1.5',
      assetSymbol: 'PUSD',
      chainId: 'solana-mainnet',
    },
    policy: {
      approvalRequired: false,
    },
    executionPlan: {
      connectorKind: 'direct',
      settlementAsset: 'PUSD',
      privacyMode: 'off',
      executionMode: 'connector',
    },
    resultRef: 'signature_alpha',
    ...overrides,
  }
}

function createMockResponse() {
  const headers = new Map<string, string>()
  let statusCode = 200
  let body: unknown
  const res = {
    locals: {},
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value)
      return this
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase())
    },
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

test('buildDashboardAgentWalletContext summarizes wallet, portfolio, and activity', async () => {
  const agent = createAgent()
  const wallet = createWallet()
  const walletContext = await buildDashboardAgentWalletContext({
    agent,
    wallet,
    owsAccess: {
      agentId: agent.agentId,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      runtimeWalletId: wallet.walletId,
      owsWalletId: 'ows_wallet_alpha',
      owsWalletName: 'alpha-ows',
      vaultPath: '/vault/alpha',
      apiKeyId: 'ows_key_alpha',
      apiKeyName: 'alpha-key',
    },
    portfolioReader: {
      async getWalletSnapshot() {
        return {
          address: wallet.address ?? '',
          positions: [
            {
              id: 'pos_1',
              symbol: 'PUSD',
              chainId: 'solana-mainnet',
              value: 125.5,
              quantity: 125.5,
            },
            {
              id: 'pos_2',
              symbol: 'wSOL',
              chainId: 'solana-mainnet',
              value: 20,
              quantity: 0.1,
            },
          ],
          transactions: [
            {
              id: 'tx_older',
              hash: 'hash_old',
              chainId: 'solana-mainnet',
              operationType: 'send',
              minedAt: '2026-06-05T10:00:00.000Z',
              direction: 'out',
              value: 5,
            },
            {
              id: 'tx_newer',
              hash: 'hash_new',
              chainId: 'solana-mainnet',
              operationType: 'swap',
              minedAt: '2026-06-05T11:00:00.000Z',
              direction: 'out',
              value: 10,
            },
          ],
          sync: {
            kind: 'synced',
            chainId: 'solana-mainnet',
            message: 'Synced.',
          },
        }
      },
    } as never,
  })

  assert.equal(walletContext.wallet.walletId, 'wallet_alpha')
  assert.equal(walletContext.wallet.address, 'AlphaWallet111')
  assert.deepEqual(walletContext.wallet.supportedChains, ['solana-mainnet', 'base'])
  assert.deepEqual(walletContext.controls.allowedAssets, ['PUSD', 'wSOL'])
  assert.equal(walletContext.controls.privacyMode, 'required')
  assert.equal(walletContext.portfolio.totalValueUsd, 145.5)
  assert.equal(walletContext.portfolio.positionsCount, 2)
  assert.equal(walletContext.portfolio.topPositions[0]?.symbol, 'PUSD')
  assert.equal(walletContext.activity.transactionsCount, 2)
  assert.equal(walletContext.activity.latestTransactionAt, '2026-06-05T11:00:00.000Z')
  assert.equal(walletContext.activity.recentTransactions[0]?.id, 'tx_newer')
  assert.equal(walletContext.owsAccess?.apiKeyName, 'alpha-key')
})

test('buildDashboardAgentWalletCycle summarizes lifecycle, wallet actions, and controls', async () => {
  const agent = createAgent()
  const wallet = createWallet({
    state: 'active_full',
  })
  const actionRequests = new InMemoryActionRequestRegistry([
    createActionRequest({
      actionRequestId: 'action_request_transfer_new',
      updatedAt: '2026-06-05T10:30:00.000Z',
      status: 'waiting_for_execution',
      title: 'Transfer pending signature',
    }),
    createActionRequest({
      actionRequestId: 'action_request_wallet_policy',
      updatedAt: '2026-06-05T10:20:00.000Z',
      kind: 'wallet.policy_update',
      status: 'executed',
      target: {
        kind: 'wallet',
        walletId: wallet.walletId,
        chainId: 'solana-mainnet',
      },
      value: undefined,
      title: 'Update wallet policy',
      summary: 'Attached transfer policy.',
    }),
    createActionRequest({
      actionRequestId: 'action_request_service_legacy',
      updatedAt: '2026-06-05T10:10:00.000Z',
      kind: 'service.pay',
      status: 'executed',
      target: {
        kind: 'service',
        serviceId: 'service.launch.audit',
        vendorId: 'vendor_launch',
      },
      title: 'Legacy service payment',
      summary: 'Should not define the wallet cycle.',
    }),
  ])
  const controlEventRegistry = new InMemoryAgentControlEventRegistry([
    {
      controlEventId: 'control_event_dead_man',
      at: '2026-06-05T10:40:00.000Z',
      agentId: agent.agentId,
      type: 'dead_man_switch.triggered',
      status: 'applied',
      summary: 'Dead-man control halted pending wallet runs.',
      refs: {
        walletId: wallet.walletId,
        haltedRunIds: ['run_alpha'],
      },
    },
  ])

  const walletCycle = await buildDashboardAgentWalletCycle({
    workspace: {
      storageDriver: 'postgres',
      agentRegistry: new InMemoryAgentRegistry([agent]),
      walletRegistry: new InMemoryWalletRegistry([wallet]),
      actionRequestRegistry: actionRequests,
      controlEventRegistry,
    } as never,
    agentId: agent.agentId,
  })

  assert.ok(walletCycle)
  assert.equal(walletCycle?.projectionMode, 'transactional_mirror')
  assert.equal(walletCycle?.wallet.walletId, wallet.walletId)
  assert.equal(walletCycle?.readiness.lifecycleStage, 'active')
  assert.equal(walletCycle?.readiness.outboundReady, true)
  assert.deepEqual(walletCycle?.readiness.blockers, [])
  assert.equal(walletCycle?.policyScope.allowedActionKinds[0], 'asset.transfer')
  assert.equal(walletCycle?.actions.total, 2)
  assert.equal(walletCycle?.actions.byKind['asset.transfer'], 1)
  assert.equal(walletCycle?.actions.byKind['wallet.policy_update'], 1)
  assert.equal(walletCycle?.actions.byKind['service.pay'], undefined)
  assert.equal(
    walletCycle?.actions.recent[0]?.actionRequestId,
    'action_request_transfer_new',
  )
  assert.equal(walletCycle?.controls.total, 1)
  assert.equal(walletCycle?.controls.applied, 1)
  assert.equal(walletCycle?.controls.lastEventAt, '2026-06-05T10:40:00.000Z')
})

test('buildDashboardAgentWalletCycle reports wallet blockers before outbound actions', async () => {
  const agent = createAgent()
  const wallet = createWallet({
    state: 'pending_compliance',
    complianceStatus: 'pending',
    policyAttachmentStatus: 'pending',
  })

  const walletCycle = await buildDashboardAgentWalletCycle({
    workspace: {
      storageDriver: 'file',
      agentRegistry: new InMemoryAgentRegistry([agent]),
      walletRegistry: new InMemoryWalletRegistry([wallet]),
      actionRequestRegistry: new InMemoryActionRequestRegistry(),
      controlEventRegistry: new InMemoryAgentControlEventRegistry(),
    } as never,
    agentId: agent.agentId,
  })

  assert.equal(walletCycle?.projectionMode, 'shadow')
  assert.equal(walletCycle?.readiness.lifecycleStage, 'policy_pending')
  assert.equal(walletCycle?.readiness.outboundReady, false)
  assert.ok(
    walletCycle?.readiness.blockers.includes('wallet_compliance_not_approved'),
  )
  assert.ok(
    walletCycle?.readiness.blockers.includes('wallet_policy_not_attached'),
  )
})

test('dashboard agent wallet cycle route requires access and returns cycle', async () => {
  const agent = createAgent()
  const wallet = createWallet({
    state: 'active_full',
  })

  const app = express()
  registerAgentWalletCycleRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      workspace: {
        storageDriver: 'file',
        agentRegistry: new InMemoryAgentRegistry([agent]),
        walletRegistry: new InMemoryWalletRegistry([wallet]),
        actionRequestRegistry: new InMemoryActionRequestRegistry([
          createActionRequest(),
        ]),
        controlEventRegistry: new InMemoryAgentControlEventRegistry(),
      },
    } as never,
  )

  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/agents/:agentId/wallet-cycle',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const deniedResponse = createMockResponse()
  await handler(
    {
      headers: {},
      params: {
        agentId: agent.agentId,
      },
      method: 'GET',
      path: `/api/dashboard/agents/${agent.agentId}/wallet-cycle`,
    } as never,
    deniedResponse.res as never,
  )
  assert.equal(deniedResponse.read().statusCode, 401)

  const allowedResponse = createMockResponse()
  await handler(
    {
      headers: {
        cookie: operatorSessionCookie({ role: 'operator' }),
      },
      params: {
        agentId: agent.agentId,
      },
      method: 'GET',
      path: `/api/dashboard/agents/${agent.agentId}/wallet-cycle`,
    } as never,
    allowedResponse.res as never,
  )

  const result = allowedResponse.read()
  assert.equal(result.statusCode, 200)
  const body = result.body as {
    ok: boolean
    walletCycle: {
      agent: { agentId: string }
      readiness: { lifecycleStage: string }
      actions: { total: number }
    }
  }
  assert.equal(body.ok, true)
  assert.equal(body.walletCycle.agent.agentId, agent.agentId)
  assert.equal(body.walletCycle.readiness.lifecycleStage, 'active')
  assert.equal(body.walletCycle.actions.total, 1)
})

test('dashboard agent roster route uses the cheap roster builder', async () => {
  const agent = createAgent()
  let rosterCalls = 0

  const app = express()
  registerAgentOnboardingRoutes(
    app,
    {
      env: {},
      buildDashboardAgentRoster: async () => {
        rosterCalls += 1
        return {
          generatedAt: '2026-06-13T00:00:00.000Z',
          summary: {
            agentCount: 1,
            executedCalls: 0,
            approvalPendingCalls: 0,
            blockedOrFailedCalls: 0,
            staleAgents: 0,
            xmtpAlertsSent: 0,
            owsBackedAgents: 1,
          },
          agents: [{ agent }],
        }
      },
      buildDashboardAgentWalletList: async () => {
        throw new Error('wallet list should not run for roster reads')
      },
      buildDashboardSnapshot: async () => {
        throw new Error('showcase snapshot should not run for roster reads')
      },
    } as never,
  )

  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/agents',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const response = createMockResponse()
  await handler(
    {
      headers: {},
      method: 'GET',
      path: '/api/dashboard/agents',
    } as never,
    response.res as never,
  )

  const result = response.read()
  assert.equal(result.statusCode, 200)
  assert.equal(rosterCalls, 1)
  assert.deepEqual(result.body, {
    ok: true,
    agents: [{ agent }],
    summary: {
      agentCount: 1,
      executedCalls: 0,
      approvalPendingCalls: 0,
      blockedOrFailedCalls: 0,
      staleAgents: 0,
      xmtpAlertsSent: 0,
      owsBackedAgents: 1,
    },
  })
})

test('dashboard agent wallet route returns live wallet snapshots without the showcase projection', async () => {
  const agent = createAgent()
  let walletCalls = 0

  const app = express()
  registerAgentOnboardingRoutes(
    app,
    {
      env: {},
      buildDashboardAgentRoster: async () => {
        throw new Error('roster builder should not run for wallet reads')
      },
      buildDashboardAgentWalletList: async () => {
        walletCalls += 1
        return {
          generatedAt: '2026-06-13T00:00:00.000Z',
          agents: [
            {
              agent,
              portfolio: {
                address: 'AlphaWallet111',
                positions: [
                  {
                    id: 'p1',
                    symbol: 'PUSD',
                    chainId: 'solana-mainnet',
                    quantity: 12.5,
                    value: 12.5,
                  },
                ],
                transactions: [],
                sync: {
                  kind: 'synced',
                  chainId: 'solana-mainnet',
                  message: 'Synced.',
                },
              },
            },
          ],
        }
      },
      buildDashboardSnapshot: async () => {
        throw new Error('showcase snapshot should not run for wallet reads')
      },
    } as never,
  )

  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/agent-wallets',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const response = createMockResponse()
  await handler(
    {
      headers: {},
      method: 'GET',
      path: '/api/dashboard/agent-wallets',
    } as never,
    response.res as never,
  )

  const result = response.read()
  assert.equal(result.statusCode, 200)
  assert.equal(walletCalls, 1)
  assert.deepEqual(result.body, {
    ok: true,
    agents: [
      {
        agent,
        portfolio: {
          address: 'AlphaWallet111',
          positions: [
            {
              id: 'p1',
              symbol: 'PUSD',
              chainId: 'solana-mainnet',
              quantity: 12.5,
              value: 12.5,
            },
          ],
          transactions: [],
          sync: {
            kind: 'synced',
            chainId: 'solana-mainnet',
            message: 'Synced.',
          },
        },
      },
    ],
  })
})

test('dashboard agent policy update writes native wallet.policy_update ActionRequest', async () => {
  const agent = createAgent()
  const wallet = createWallet()
  const agentRegistry = new InMemoryAgentRegistry([agent])
  const actionRequests = new InMemoryActionRequestRegistry()
  const audit = new InMemoryDashboardAuditLogRegistry()

  const app = express()
  registerAgentPolicyRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      workspace: {
        agentRegistry,
        walletRegistry: new InMemoryWalletRegistry([wallet]),
        actionRequestRegistry: actionRequests,
        dashboardAuditLogRegistry: audit,
      },
      buildDashboardSnapshot: async () => ({}),
    } as never,
  )
  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/agents/:agentId/policy',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const response = createMockResponse()
  await handler(
    {
      headers: {
        cookie: operatorSessionCookie({ role: 'operator' }),
      },
      params: {
        agentId: agent.agentId,
      },
      body: {
        maxPerTransaction: '3',
        autoApproveUnder: '1',
        sessionBudget: '9',
        heartbeatTimeoutSeconds: 1200,
      },
      method: 'PATCH',
      path: `/api/dashboard/agents/${agent.agentId}/policy`,
    } as never,
    response.res as never,
  )

  const result = response.read()
  assert.equal(result.statusCode, 200)
  const body = result.body as {
    ok: boolean
    agent: { agentId: string; policyConfig: { maxPerTransaction: string } }
    snapshot: Record<string, unknown>
  }
  assert.equal(body.ok, true)
  assert.equal(body.agent.agentId, agent.agentId)
  assert.equal(body.agent.policyConfig.maxPerTransaction, '3')
  assert.deepEqual(body.snapshot, {})
  const updatedAgent = await agentRegistry.get(agent.agentId)
  assert.equal(updatedAgent?.policyConfig.maxPerTransaction, '3')
  assert.equal(updatedAgent?.policyConfig.autoApproveUnder, '1')
  assert.equal(updatedAgent?.policyConfig.sessionBudget, '9')

  const records = await actionRequests.list()
  assert.equal(records.length, 1)
  assert.equal(records[0]?.kind, 'wallet.policy_update')
  assert.equal(records[0]?.status, 'executed')
  assert.equal(records[0]?.source, 'dashboard')
  assert.equal(records[0]?.target.kind, 'wallet')
  assert.equal(records[0]?.walletId, wallet.walletId)
  assert.equal(
    records[0]?.requestContext?.appliedPolicy &&
      typeof records[0].requestContext.appliedPolicy === 'object',
    true,
  )

  const audits = await audit.list()
  assert.equal(audits[0]?.metadata?.actionRequestKind, 'wallet.policy_update')
  assert.equal(audits[0]?.metadata?.actionRequestId, records[0]?.actionRequestId)
})

test('dashboard agent policy validation blocks native wallet.policy_update ActionRequest', async () => {
  const agent = createAgent()
  const agentRegistry = new InMemoryAgentRegistry([agent])
  const actionRequests = new InMemoryActionRequestRegistry()

  const app = express()
  registerAgentPolicyRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      workspace: {
        agentRegistry,
        walletRegistry: new InMemoryWalletRegistry([createWallet()]),
        actionRequestRegistry: actionRequests,
        dashboardAuditLogRegistry: new InMemoryDashboardAuditLogRegistry(),
      },
      buildDashboardSnapshot: async () => ({}),
    } as never,
  )
  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/agents/:agentId/policy',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const response = createMockResponse()
  await handler(
    {
      headers: {
        cookie: operatorSessionCookie({ role: 'operator' }),
      },
      params: {
        agentId: agent.agentId,
      },
      body: {
        maxPerTransaction: '1',
        autoApproveUnder: '3',
      },
      method: 'PATCH',
      path: `/api/dashboard/agents/${agent.agentId}/policy`,
    } as never,
    response.res as never,
  )

  const result = response.read()
  assert.equal(result.statusCode, 400)
  const records = await actionRequests.list()
  assert.equal(records.length, 1)
  assert.equal(records[0]?.kind, 'wallet.policy_update')
  assert.equal(records[0]?.status, 'blocked')
  assert.equal(records[0]?.errorCode, 'policy.invalid_wallet_policy_update')
  const unchangedAgent = await agentRegistry.get(agent.agentId)
  assert.equal(
    unchangedAgent?.policyConfig.maxPerTransaction,
    agent.policyConfig.maxPerTransaction,
  )
})

test('dashboard agent policy conflict creates failed native wallet.policy_update ActionRequest', async () => {
  const initialAgent = createAgent()
  const currentAgent = createAgent({
    updatedAt: '2026-06-05T10:05:00.000Z',
    policyConfig: {
      ...initialAgent.policyConfig,
      maxPerTransaction: '4',
      autoApproveUnder: '2',
    },
  })
  let getCount = 0
  const agentRegistry = {
    async get(agentId: string) {
      if (agentId !== initialAgent.agentId) {
        return undefined
      }
      getCount += 1
      return getCount === 1 ? initialAgent : currentAgent
    },
    async putIfUpdatedAt() {
      return false
    },
  }
  const actionRequests = new InMemoryActionRequestRegistry()
  const audit = new InMemoryDashboardAuditLogRegistry()

  const app = express()
  registerAgentPolicyRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      workspace: {
        agentRegistry,
        walletRegistry: new InMemoryWalletRegistry([createWallet()]),
        actionRequestRegistry: actionRequests,
        dashboardAuditLogRegistry: audit,
      },
      buildDashboardSnapshot: async () => ({}),
    } as never,
  )
  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/agents/:agentId/policy',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const response = createMockResponse()
  await handler(
    {
      headers: {
        cookie: operatorSessionCookie({ role: 'operator' }),
      },
      params: {
        agentId: initialAgent.agentId,
      },
      body: {
        maxPerTransaction: '3',
        autoApproveUnder: '1',
      },
      method: 'PATCH',
      path: `/api/dashboard/agents/${initialAgent.agentId}/policy`,
    } as never,
    response.res as never,
  )

  const result = response.read()
  assert.equal(result.statusCode, 409)
  const body = result.body as {
    ok: false
    error: string
    message: string
    details?: { currentUpdatedAt?: string }
  }
  assert.equal(body.error, 'agent_conflict')
  assert.equal(body.message, 'Agent changed while the policy update was in progress.')
  assert.equal(body.details?.currentUpdatedAt, currentAgent.updatedAt)

  const records = await actionRequests.list()
  assert.equal(records.length, 1)
  assert.equal(records[0]?.kind, 'wallet.policy_update')
  assert.equal(records[0]?.status, 'failed')
  assert.equal(records[0]?.errorCode, 'agent_conflict')

  const audits = await audit.list()
  assert.equal(audits.length, 1)
  assert.equal(audits[0]?.status, 'failed')
  assert.equal(audits[0]?.metadata?.actionRequestKind, 'wallet.policy_update')
  assert.equal(audits[0]?.metadata?.actionRequestId, records[0]?.actionRequestId)
})

test('dashboard agent policy update replays idempotent retries without duplicating wallet.policy_update records', async () => {
  const agent = createAgent()
  const wallet = createWallet()
  const agentRegistry = new InMemoryAgentRegistry([agent])
  const actionRequests = new InMemoryActionRequestRegistry()
  const audit = new InMemoryDashboardAuditLogRegistry()

  const app = express()
  registerAgentPolicyRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      workspace: {
        agentRegistry,
        walletRegistry: new InMemoryWalletRegistry([wallet]),
        actionRequestRegistry: actionRequests,
        dashboardAuditLogRegistry: audit,
      },
      mutationIdempotency: createDashboardMutationIdempotencyStore(),
      buildDashboardSnapshot: async () => ({}),
    } as never,
  )
  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/agents/:agentId/policy',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const request = {
    headers: {
      cookie: operatorSessionCookie({ role: 'operator' }),
      'idempotency-key': 'policy-update-1',
    },
    params: {
      agentId: agent.agentId,
    },
    body: {
      maxPerTransaction: '3',
      autoApproveUnder: '1',
      sessionBudget: '9',
    },
    method: 'PATCH',
    path: `/api/dashboard/agents/${agent.agentId}/policy`,
  }

  const firstResponse = createMockResponse()
  await handler(request as never, firstResponse.res as never)

  const replayResponse = createMockResponse()
  await handler(request as never, replayResponse.res as never)

  assert.equal(firstResponse.read().statusCode, 200)
  assert.equal(replayResponse.read().statusCode, 200)
  assert.deepEqual(replayResponse.read().body, firstResponse.read().body)
  assert.equal(
    replayResponse.res.getHeader('Idempotency-Replayed'),
    'true',
  )

  const records = await actionRequests.list()
  assert.equal(records.length, 1)
  assert.equal(records[0]?.status, 'executed')

  const audits = await audit.list()
  assert.equal(audits.length, 1)
  assert.equal(audits[0]?.metadata?.actionRequestId, records[0]?.actionRequestId)
})

test('dashboard agent wallet context route requires access and returns context', async () => {
  const agent = createAgent()
  const wallet = createWallet()

  const app = express()
  registerAgentWalletContextRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_SESSION_SECRET: TEST_SESSION_SECRET,
      },
      workspace: {
        agentRegistry: new InMemoryAgentRegistry([agent]),
        walletRegistry: new InMemoryWalletRegistry([wallet]),
        owsAccessRegistry: {
          async get(agentId: string) {
            return agentId === agent.agentId
              ? {
                  agentId,
                  createdAt: agent.createdAt,
                  updatedAt: agent.updatedAt,
                  runtimeWalletId: wallet.walletId,
                  owsWalletId: 'ows_wallet_alpha',
                  owsWalletName: 'alpha-ows',
                  vaultPath: '/vault/alpha',
                }
              : undefined
          },
        },
      },
      portfolioReader: {
        async getWalletSnapshot() {
          return {
            address: wallet.address ?? '',
            positions: [],
            transactions: [],
            sync: {
              kind: 'disabled',
              chainId: 'solana-mainnet',
              message: 'Disabled.',
            },
          }
        },
      },
    } as never,
  )

  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/dashboard/agents/:agentId/wallet-context',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const deniedResponse = createMockResponse()
  await handler(
    {
      headers: {},
      params: {
        agentId: agent.agentId,
      },
      method: 'GET',
      path: `/api/dashboard/agents/${agent.agentId}/wallet-context`,
    } as never,
    deniedResponse.res as never,
  )
  assert.equal(deniedResponse.read().statusCode, 401)

  const allowedResponse = createMockResponse()
  await handler(
    {
      headers: {
        cookie: operatorSessionCookie({ role: 'operator' }),
      },
      params: {
        agentId: agent.agentId,
      },
      method: 'GET',
      path: `/api/dashboard/agents/${agent.agentId}/wallet-context`,
    } as never,
    allowedResponse.res as never,
  )

  const result = allowedResponse.read()
  assert.equal(result.statusCode, 200)
  const body = result.body as {
    ok: boolean
    walletContext: {
      agentId: string
      wallet: { address?: string }
      controls: { privacyMode: string }
      portfolio: { sync: { kind: string } }
    }
  }
  assert.equal(body.ok, true)
  assert.equal(body.walletContext.agentId, agent.agentId)
  assert.equal(body.walletContext.wallet.address, 'AlphaWallet111')
  assert.equal(body.walletContext.controls.privacyMode, 'required')
  assert.equal(body.walletContext.portfolio.sync.kind, 'disabled')
})

test('SDK wallet route returns agent-facing wallet context and requires a credential', async () => {
  const agent = createAgent()
  const wallet = createWallet()
  const agentCredentialRegistry = new InMemoryAgentCredentialRegistry()
  const credential = await createAgentCredential(
    {
      credentials: agentCredentialRegistry,
      now: () => '2026-06-08T00:00:00.000Z',
      createId: (prefix) => `${prefix}_wallet_ctx_test`,
    },
    { agentId: agent.agentId },
  )

  const app = express()
  registerSdkRoutes(
    app,
    {
      env: {},
      operationalMetrics: createDashboardOperationalMetricsStore(),
      workspace: {
        agentRegistry: new InMemoryAgentRegistry([agent]),
        agentCredentialRegistry,
        walletRegistry: new InMemoryWalletRegistry([wallet]),
        owsAccessRegistry: {
          async get() {
            return undefined
          },
        },
      },
      portfolioReader: {
        async getWalletSnapshot() {
          return {
            address: wallet.address ?? '',
            positions: [
              {
                id: 'p1',
                symbol: 'PUSD',
                chainId: 'solana-mainnet',
                quantity: 12.5,
                value: 12.5,
              },
              { id: 'p2', symbol: 'SOL', chainId: 'solana-mainnet', quantity: 1.2 },
            ],
            transactions: [
              {
                id: 't1',
                hash: 't1',
                chainId: 'solana-mainnet',
                minedAt: '2026-06-08T00:00:00.000Z',
              },
            ],
            sync: { kind: 'synced', chainId: 'solana-mainnet', message: 'Synced.' },
          }
        },
      },
    } as never,
  )

  const layer = app.router.stack.find(
    (entry) => entry.route?.path === '/api/sdk/v1/wallet',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const deniedResponse = createMockResponse()
  await handler(
    { headers: {}, method: 'GET', path: '/api/sdk/v1/wallet' } as never,
    deniedResponse.res as never,
  )
  assert.equal(deniedResponse.read().statusCode, 401)

  const allowedResponse = createMockResponse()
  await handler(
    {
      headers: { authorization: `Bearer ${credential.token}` },
      method: 'GET',
      path: '/api/sdk/v1/wallet',
    } as never,
    allowedResponse.res as never,
  )

  const result = allowedResponse.read()
  assert.equal(result.statusCode, 200)
  const body = result.body as {
    ok: boolean
    agentId: string
    wallet: { address?: string }
    portfolio: { positionsCount: number; totalValueUsd: number; sync: { kind: string } }
    controls: {
      privacyMode: string
      allowedChains: string[]
      maxPerTransaction?: string
      autoApproveUnder?: string
      sessionBudget?: string
    }
  }
  assert.equal(body.ok, true)
  assert.equal(body.agentId, agent.agentId)
  assert.equal(body.wallet.address, 'AlphaWallet111')
  assert.equal(body.portfolio.positionsCount, 2)
  assert.equal(body.portfolio.totalValueUsd, 12.5)
  assert.equal(body.portfolio.sync.kind, 'synced')
  assert.equal(body.controls.privacyMode, 'required')
  assert.deepEqual(body.controls.allowedChains, ['solana-mainnet'])
  assert.equal(body.controls.maxPerTransaction, '2')
  assert.equal(body.controls.autoApproveUnder, '0.05')
  assert.equal(body.controls.sessionBudget, '5')
})
