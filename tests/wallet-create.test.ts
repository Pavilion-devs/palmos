import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DefaultSessionKernel,
  FileKernelPersistence,
  InMemoryRunRegistry,
  InMemorySessionRegistry,
  InMemoryWalletRegistry,
} from '../runtime/index.js'
import { createAgentWallet } from '../src/app/createAgentWallet.js'
import { reconcileWalletActions } from '../src/app/reconcileWalletActions.js'
import { createAgentPolicyCandidateResolver } from '../src/policies/compileAgentPolicy.js'
import {
  InMemoryActionRequestRegistry,
  type ActionRequestRecord,
} from '../src/store/ActionRequestRegistry.js'
import { InMemoryAgentRegistry } from '../src/store/AgentRegistry.js'

const NOW = '2026-06-05T12:00:00.000Z'

function createIdFactory(): (prefix: string) => string {
  let sequence = 0
  return (prefix: string) => `${prefix}_${++sequence}`
}

async function createWalletCreateDeps() {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-wallet-create-'))
  const createId = createIdFactory()
  const agentRegistry = new InMemoryAgentRegistry()
  const walletRegistry = new InMemoryWalletRegistry()
  const actionRequests = new InMemoryActionRequestRegistry()
  const kernel = new DefaultSessionKernel({
    persistence: new FileKernelPersistence(dir),
    sessions: new InMemorySessionRegistry(),
    runs: new InMemoryRunRegistry(),
    walletRegistry,
    getPolicyCandidates: createAgentPolicyCandidateResolver({
      agentRegistry,
      now: () => NOW,
    }),
    now: () => NOW,
    createId,
  })

  return {
    dir,
    createId,
    deps: {
      kernel,
      agentRegistry,
      walletRegistry,
      actionRequests,
      now: () => NOW,
      createId,
    },
    agentRegistry,
    walletRegistry,
    actionRequests,
  }
}

function createWalletInput() {
  return {
    agentId: 'agent_wallet_create_test',
    displayName: 'Wallet Create Test Agent',
    organizationId: 'org_wallet_create',
    treasuryId: 'treasury_wallet_create',
    environment: 'test' as const,
    managerActorId: 'manager_wallet_create',
    managerRoleIds: ['manager'],
    walletType: 'ops' as const,
    settlementMode: 'local-demo' as const,
    subjectType: 'team' as const,
    policyConfig: {
      agentId: 'agent_wallet_create_test',
      organizationId: 'org_wallet_create',
      environment: 'test' as const,
      walletType: 'ops' as const,
      allowedChains: ['solana-devnet'],
      allowedAssets: ['PUSD'],
      allowedSignerClasses: ['multisig' as const],
      allowedVendors: [],
      autoApproveUnder: '1',
      maxPerTransaction: '5',
      sessionBudget: '25',
      heartbeatTimeoutSeconds: 300,
      policyProfileId: 'policy_wallet_create_test',
    },
  }
}

test('createAgentWallet writes executed native wallet.create ActionRequest', async () => {
  const context = await createWalletCreateDeps()
  try {
    const result = await createAgentWallet(context.deps, createWalletInput())

    assert.equal(result.agent.status, 'ready')
    assert.ok(result.agent.walletId)
    assert.equal(result.run?.actionType, 'wallet.create')
    assert.equal(result.run?.status, 'completed')

    const records = await context.actionRequests.list()
    assert.equal(records.length, 1)
    assert.equal(records[0]?.kind, 'wallet.create')
    assert.equal(records[0]?.status, 'executed')
    assert.equal(records[0]?.agentId, result.agent.agentId)
    assert.equal(records[0]?.walletId, result.agent.walletId)
    assert.equal(records[0]?.target.kind, 'wallet')
    assert.equal(
      records[0]?.target.kind === 'wallet' && records[0].target.walletId,
      result.agent.walletId,
    )
    assert.equal(records[0]?.resultRef, result.agent.walletId)
    assert.equal(records[0]?.runtimeRefs?.runId, result.run?.runId)
    assert.equal(records[0]?.runtimeRefs?.intentIds[0], result.run?.intentRef?.intentId)
    assert.equal(records[0]?.requestContext?.runtimeStatus, 'completed')
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('createAgentWallet records failed native wallet.create for duplicate agent ids', async () => {
  const context = await createWalletCreateDeps()
  try {
    await createAgentWallet(context.deps, createWalletInput())

    await assert.rejects(
      () => createAgentWallet(context.deps, createWalletInput()),
      /already exists/,
    )

    const records = await context.actionRequests.list()
    assert.equal(records.length, 2)
    const failed = records.find((record) => record.status === 'failed')
    assert.ok(failed)
    assert.equal(failed?.kind, 'wallet.create')
    assert.equal(failed?.errorCode, 'agent.already_exists')
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})

test('reconcileWalletActions marks stale wallet.create records as failed', async () => {
  const context = await createWalletCreateDeps()
  try {
    const staleRecord: ActionRequestRecord = {
      actionRequestId: 'action_request_stale_wallet_create',
      createdAt: '2026-06-05T11:00:00.000Z',
      updatedAt: '2026-06-05T11:00:00.000Z',
      agentId: 'agent_stale_wallet_create',
      organizationId: 'org_wallet_create',
      treasuryId: 'treasury_wallet_create',
      source: 'dashboard',
      kind: 'wallet.create',
      status: 'created',
      target: {
        kind: 'wallet',
        walletId: 'agent:agent_stale_wallet_create',
        chainId: 'solana-devnet',
      },
      title: 'Create agent wallet',
      summary: 'Stale wallet creation request.',
      requestPayload: {
        agentId: 'agent_stale_wallet_create',
      },
      requestContext: {
        nativeActionRequest: true,
      },
      policy: {
        approvalRequired: false,
      },
      executionPlan: {
        connectorKind: 'direct',
        privacyMode: 'off',
        executionMode: 'connector',
      },
      runtimeRefs: {
        sessionId: 'manager:org_wallet_create',
        intentIds: [],
      },
    }
    await context.actionRequests.put(staleRecord)

    const result = await reconcileWalletActions(context.deps, {
      staleAfterMs: 1,
    })

    assert.equal(result.staleWalletActions.checked, 1)
    assert.equal(result.staleWalletActions.updated, 1)
    assert.equal(result.staleWalletActions.results[0]?.kind, 'wallet.create')
    assert.equal(result.staleWalletActions.results[0]?.nextStatus, 'failed')

    const refreshed = await context.actionRequests.get(
      staleRecord.actionRequestId,
    )
    assert.equal(refreshed?.status, 'failed')
    assert.equal(refreshed?.errorCode, 'action.lifecycle_timeout')
  } finally {
    await rm(context.dir, { recursive: true, force: true })
  }
})
