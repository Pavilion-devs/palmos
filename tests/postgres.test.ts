import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPostgresPool,
  runPalmosPostgresMigrations,
} from '../src/storage/postgres/client.js'
import {
  PostgresActionRequestRegistry,
  PostgresAgentCredentialRegistry,
  PostgresAgentRegistry,
  PostgresDashboardAuditLogRegistry,
  PostgresDashboardOperatorRegistry,
  PostgresDashboardWorkspaceRegistry,
  PostgresPaidCallRegistry,
  PostgresPalmosServiceRegistry,
  PostgresPusdReadinessReportRegistry,
  PostgresRunRegistry,
  PostgresSessionRegistry,
  PostgresWalletRegistry,
  PostgresXMTPAlertRegistry,
} from '../src/storage/postgres/registries.js'
import {
  PostgresArtifactStore,
  PostgresExecutionLedger,
  PostgresTranscriptStore,
} from '../src/storage/postgres/runtimePersistence.js'
import { loadAgentSpendWorkspace } from '../src/workspace/loadWorkspace.js'
import type { AgentRecord } from '../src/store/AgentRegistry.js'
import type { AgentCredentialRecord } from '../src/store/AgentCredentialRegistry.js'
import type { PaidCallRecord } from '../src/store/PaidCallRegistry.js'
import type { RegisteredPalmosServiceRecord } from '../src/store/PalmosServiceRegistry.js'
import type { DashboardAuditLogRecord } from '../src/store/DashboardAuditLogRegistry.js'
import type { DashboardOperatorRecord } from '../src/store/DashboardOperatorRegistry.js'
import type { DashboardWorkspaceRecord } from '../src/store/DashboardWorkspaceRegistry.js'
import type { PusdReadinessReportRecord } from '../src/store/PusdReadinessReportRegistry.js'
import type { XMTPAlertRecord } from '../src/store/XMTPAlertRegistry.js'
import type { WalletRecord } from '../runtime/contracts/wallet.js'
import type {
  RunState,
  SessionState,
  TranscriptEntry,
} from '../runtime/contracts/runtime.js'
import type { LedgerEvent } from '../runtime/contracts/ledger.js'

const databaseUrl = process.env.PALMOS_TEST_DATABASE_URL

async function assertTestDatabase(pool: ReturnType<typeof createPostgresPool>) {
  const result = await pool.query<{ current_database: string }>(
    'select current_database()',
  )
  const databaseName = result.rows[0]?.current_database ?? ''
  assert.match(
    databaseName,
    /test/i,
    `Refusing to run destructive Postgres tests against database "${databaseName}". Use a dedicated test database.`,
  )
}

async function truncateTestTables(pool: ReturnType<typeof createPostgresPool>) {
  await pool.query(`
    truncate table
      runtime_artifacts,
      runtime_ledger_events,
      runtime_transcript_entries,
      runtime_runs,
      runtime_sessions,
      pusd_readiness_reports,
      ows_access,
      xmtp_alerts,
      agent_control_events,
      dashboard_audit_logs,
      paid_calls,
      action_requests,
      registered_services,
      agent_credentials,
      agents,
      wallets,
      dashboard_operators,
      dashboard_workspaces
    restart identity cascade
  `)
}

function createAgent(now: string): AgentRecord {
  return {
    agentId: 'pg_agent',
    createdAt: now,
    updatedAt: now,
    displayName: 'Postgres Agent',
    organizationId: 'org_pg',
    environment: 'production',
    actorId: 'agent:pg_agent',
    sessionId: 'session_pg',
    walletType: 'ops',
    settlementMode: 'local-demo',
    walletId: 'wallet_pg',
    walletState: 'active_limited',
    policyConfig: {
      agentId: 'pg_agent',
      organizationId: 'org_pg',
      environment: 'production',
      walletType: 'ops',
      allowedChains: ['solana-mainnet'],
      allowedAssets: ['PUSD'],
      allowedSignerClasses: ['multisig'],
      allowedVendors: [
        {
          vendorId: 'vendor_pg',
          label: 'Vendor PG',
          destinationAddress: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
          chainId: 'solana-mainnet',
        },
      ],
      autoApproveUnder: '0.05',
      maxPerTransaction: '1',
      sessionBudget: '1',
      heartbeatTimeoutSeconds: 900,
      privacyMode: 'allowed',
    },
    trustTier: 'healthy',
    status: 'ready',
    lastCheckInAt: now,
  }
}

test('Postgres storage adapters persist PalmOS records', {
  skip: !databaseUrl,
}, async () => {
  if (!databaseUrl) {
    return
  }

  const pool = createPostgresPool({ databaseUrl })
  const now = '2026-05-15T09:00:00.000Z'

  try {
    await runPalmosPostgresMigrations(pool)
    await assertTestDatabase(pool)
    await truncateTestTables(pool)

    const workspaces = new PostgresDashboardWorkspaceRegistry(pool)
    const operators = new PostgresDashboardOperatorRegistry(pool)
    const wallets = new PostgresWalletRegistry(pool)
    const agents = new PostgresAgentRegistry(pool)
    const credentials = new PostgresAgentCredentialRegistry(pool)
    const services = new PostgresPalmosServiceRegistry(pool)
    const actionRequests = new PostgresActionRequestRegistry(pool)
    const paidCalls = new PostgresPaidCallRegistry(pool, actionRequests)
    const audit = new PostgresDashboardAuditLogRegistry(pool)
    const readiness = new PostgresPusdReadinessReportRegistry(pool)
    const sessions = new PostgresSessionRegistry(pool)
    const runs = new PostgresRunRegistry(pool)
    const xmtpAlerts = new PostgresXMTPAlertRegistry(pool)
    const transcript = new PostgresTranscriptStore(pool)
    const ledger = new PostgresExecutionLedger(pool)
    const artifacts = new PostgresArtifactStore(pool)

    const workspace: DashboardWorkspaceRecord = {
      workspaceId: 'workspace_pg',
      createdAt: now,
      updatedAt: now,
      displayName: 'Postgres Workspace',
      status: 'active',
      settings: {
        defaultSettlementMode: 'local-demo',
      },
    }
    await workspaces.put(workspace)

    const operator: DashboardOperatorRecord = {
      operatorId: 'operator_pg',
      workspaceId: workspace.workspaceId,
      createdAt: now,
      updatedAt: now,
      displayName: 'Operator PG',
      role: 'owner',
      status: 'active',
      source: 'env',
    }
    await operators.put(operator)

    const wallet: WalletRecord = {
      walletId: 'wallet_pg',
      createdAt: now,
      updatedAt: now,
      state: 'active_limited',
      organizationId: 'org_pg',
      treasuryId: 'treasury_pg',
      subjectId: 'pg_agent',
      walletType: 'ops',
      address: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
      supportedChains: ['solana-mainnet'],
      complianceStatus: 'approved',
      policyAttachmentStatus: 'attached',
      signerHealthStatus: 'healthy',
      trustStatus: 'sufficient',
    }
    await wallets.put(wallet)

    const agent = createAgent(now)
    await agents.put(agent)

    const credential: AgentCredentialRecord = {
      credentialId: 'credential_pg',
      agentId: agent.agentId,
      createdAt: now,
      updatedAt: now,
      label: 'Postgres credential',
      keyPrefix: 'palmos_pg',
      keyHash: 'hash_pg',
      status: 'active',
    }
    await credentials.put(credential)

    const service: RegisteredPalmosServiceRecord = {
      serviceId: 'service_pg',
      createdAt: now,
      updatedAt: now,
      label: 'Postgres Service',
      vendorId: 'vendor_pg',
      destinationAddress: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
      endpointUrl: 'https://api.example.com/paid',
      method: 'POST',
      requestMode: 'json',
      expectedAmount: '0.01',
      chainId: 'solana-mainnet',
      status: 'active',
      verificationStatus: 'verified',
      verifiedAt: now,
    }
    await services.put(service)

    const paidCall: PaidCallRecord = {
      executionId: 'paid_call_pg',
      createdAt: now,
      updatedAt: now,
      agentId: agent.agentId,
      serviceId: service.serviceId,
      vendorId: service.vendorId,
      paymentRail: 'palmos-pusd',
      settlementMode: 'local-demo',
      amount: '0.01',
      assetSymbol: 'PUSD',
      status: 'executed',
      requestPayload: { base: 'BTC', quote: 'USD' },
      requestSummary: { base: 'BTC' },
    }
    await paidCalls.put(paidCall)
    const mirroredPaidCall = await actionRequests.get(paidCall.executionId)
    assert.equal(mirroredPaidCall?.status, 'executed')
    assert.equal(mirroredPaidCall?.kind, 'service.pay')

    const pendingPaidCall: PaidCallRecord = {
      ...paidCall,
      executionId: 'paid_call_pending_pg',
      status: 'approval_pending',
      updatedAt: '2026-05-15T12:01:00.000Z',
    }
    await paidCalls.put(pendingPaidCall)
    assert.equal(
      await paidCalls.putIfStatus(
        {
          ...pendingPaidCall,
          status: 'waiting_for_execution',
          updatedAt: '2026-05-15T12:02:00.000Z',
        },
        'executed',
      ),
      false,
    )
    assert.equal(
      (await paidCalls.get(pendingPaidCall.executionId))?.status,
      'approval_pending',
    )
    assert.equal(
      await paidCalls.putIfStatus(
        {
          ...pendingPaidCall,
          status: 'waiting_for_execution',
          updatedAt: '2026-05-15T12:03:00.000Z',
        },
        'approval_pending',
      ),
      true,
    )
    const mirroredPending = await actionRequests.get(
      pendingPaidCall.executionId,
    )
    assert.equal(mirroredPending?.status, 'waiting_for_execution')
    assert.equal(mirroredPending?.policy.approvalRequired, true)
    assert.equal(
      (await paidCalls.get(pendingPaidCall.executionId))?.status,
      'waiting_for_execution',
    )
    const queriedActionRequests = await actionRequests.query({
      agentId: agent.agentId,
      source: 'system',
      limit: 5,
    })
    assert.equal(queriedActionRequests.summary.totalMatching, 2)
    assert.equal(queriedActionRequests.summary.bySource.system, 2)
    assert.deepEqual(
      queriedActionRequests.records.map((record) => record.actionRequestId),
      ['paid_call_pending_pg', 'paid_call_pg'],
    )

    const auditRecord: DashboardAuditLogRecord = {
      auditLogId: 'audit_pg',
      at: now,
      workspaceId: workspace.workspaceId,
      actorId: operator.operatorId,
      operatorId: operator.operatorId,
      operatorRole: 'owner',
      source: 'env',
      action: 'agent.create',
      status: 'succeeded',
      target: {
        type: 'agent',
        id: agent.agentId,
      },
      summary: 'Created Postgres agent.',
    }
    await audit.put(auditRecord)

    const readinessReport: PusdReadinessReportRecord = {
      reportId: 'readiness_pg',
      createdAt: now,
      updatedAt: now,
      agentId: agent.agentId,
      serviceId: service.serviceId,
      walletName: 'wallet_pg',
      ok: true,
      report: {
        ok: true,
        generatedAt: now,
        checks: [],
      } as never,
    }
    await readiness.put(readinessReport)

    const session: SessionState = {
      sessionId: 'session_pg',
      createdAt: now,
      updatedAt: now,
      mode: 'api',
      environment: 'production',
      orgContext: {
        organizationId: 'org_pg',
        treasuryIds: ['treasury_pg'],
        walletIds: ['wallet_pg'],
      },
      actorContext: {
        actorId: agent.actorId,
        roleIds: ['agent'],
      },
      activeRunId: 'run_pg',
      runIds: ['run_pg'],
      pendingApprovalRunIds: [],
      pendingSignatureRunIds: [],
      pendingConfirmationRunIds: [],
      halted: false,
      transcriptRef: 'transcript_pg',
    }
    await sessions.put(session)

    const run: RunState = {
      runId: 'run_pg',
      sessionId: session.sessionId,
      actionType: 'asset.transfer',
      status: 'completed',
      currentPhase: 'closed',
      simulationRefs: [],
      signatureRequestRefs: [],
      signatureResultRefs: [],
      broadcastRefs: [],
      simulationArtifactPaths: [],
      signatureRequestArtifactPaths: [],
      signatureResultArtifactPaths: [],
      broadcastArtifactPaths: [],
      lastUpdatedAt: now,
    }
    await runs.put(run)

    const alert: XMTPAlertRecord = {
      alertId: 'alert_pg',
      createdAt: now,
      updatedAt: now,
      type: 'approval.requested',
      status: 'sent',
      agentId: agent.agentId,
      executionId: paidCall.executionId,
      messagePreview: 'Approval requested.',
    }
    await xmtpAlerts.put(alert)

    const transcriptEntry: TranscriptEntry = {
      entryId: 'transcript_entry_pg',
      at: now,
      sessionId: session.sessionId,
      runId: run.runId,
      role: 'system',
      content: 'Postgres transcript entry.',
    }
    await transcript.append(transcriptEntry)

    const ledgerEvent: LedgerEvent = {
      eventId: 'ledger_pg',
      eventType: 'test.event',
      at: now,
      sessionId: session.sessionId,
      runId: run.runId,
      phase: 'closed',
      actor: {
        actorId: 'system',
        actorType: 'system',
      },
      refs: {
        walletIds: [wallet.walletId],
      },
      summary: 'Postgres ledger event.',
      payload: {
        ok: true,
      },
    }
    await ledger.append(ledgerEvent)

    const artifact = await artifacts.write(
      {
        artifactType: 'report',
        path: 'artifacts/report.json',
      },
      {
        ok: true,
      },
    )

    assert.deepEqual(await workspaces.get(workspace.workspaceId), workspace)
    assert.equal(
      await workspaces.putIfUpdatedAt(
        {
          ...workspace,
          displayName: 'Should not write',
          updatedAt: '2026-05-09T12:01:00.000Z',
        },
        '2026-05-09T11:59:00.000Z',
      ),
      false,
    )
    assert.deepEqual(await workspaces.get(workspace.workspaceId), workspace)
    const updatedWorkspace: DashboardWorkspaceRecord = {
      ...workspace,
      displayName: 'Updated Postgres Workspace',
      updatedAt: '2026-05-09T12:02:00.000Z',
    }
    assert.equal(
      await workspaces.putIfUpdatedAt(updatedWorkspace, workspace.updatedAt),
      true,
    )
    assert.deepEqual(await workspaces.get(workspace.workspaceId), updatedWorkspace)
    assert.deepEqual(await operators.get(operator.operatorId), operator)
    assert.equal(
      await operators.putIfUpdatedAt(
        {
          ...operator,
          displayName: 'Should not write',
          updatedAt: '2026-05-09T12:01:00.000Z',
        },
        '2026-05-09T11:59:00.000Z',
      ),
      false,
    )
    assert.deepEqual(await operators.get(operator.operatorId), operator)
    const disabledOperator: DashboardOperatorRecord = {
      ...operator,
      status: 'disabled',
      updatedAt: '2026-05-09T12:02:00.000Z',
    }
    assert.equal(
      await operators.putIfUpdatedAt(disabledOperator, operator.updatedAt),
      true,
    )
    assert.deepEqual(await operators.get(operator.operatorId), disabledOperator)
    assert.deepEqual(await wallets.get(wallet.walletId), wallet)
    assert.deepEqual(await wallets.listByOrganization('org_pg'), [wallet])
    assert.equal(
      await wallets.putIfUpdatedAt(
        {
          ...wallet,
          state: 'suspended',
          updatedAt: '2026-05-09T12:01:00.000Z',
        },
        '2026-05-09T11:59:00.000Z',
      ),
      false,
    )
    assert.deepEqual(await wallets.get(wallet.walletId), wallet)
    const suspendedWallet: WalletRecord = {
      ...wallet,
      state: 'suspended',
      updatedAt: '2026-05-09T12:02:00.000Z',
    }
    assert.equal(
      await wallets.putIfUpdatedAt(suspendedWallet, wallet.updatedAt),
      true,
    )
    assert.deepEqual(await wallets.get(wallet.walletId), suspendedWallet)
    assert.deepEqual(await agents.get(agent.agentId), agent)
    assert.deepEqual(await agents.getByActorId(agent.actorId), agent)
    assert.deepEqual(await agents.getByWalletId(wallet.walletId), agent)
    assert.equal(
      await agents.putIfUpdatedAt(
        {
          ...agent,
          displayName: 'Should not write',
          updatedAt: '2026-05-09T12:01:00.000Z',
        },
        '2026-05-09T11:59:00.000Z',
      ),
      false,
    )
    assert.deepEqual(await agents.get(agent.agentId), agent)
    const updatedAgent: AgentRecord = {
      ...agent,
      displayName: 'Updated Postgres Agent',
      updatedAt: '2026-05-09T12:02:00.000Z',
    }
    assert.equal(await agents.putIfUpdatedAt(updatedAgent, agent.updatedAt), true)
    assert.deepEqual(await agents.get(agent.agentId), updatedAgent)
    assert.deepEqual(await credentials.get(credential.credentialId), credential)
    assert.deepEqual(await credentials.listByAgent(agent.agentId), [credential])
    assert.equal(
      await credentials.putIfStatus(
        {
          ...credential,
          label: 'Should not write',
          updatedAt: '2026-05-09T12:01:00.000Z',
        },
        'revoked',
      ),
      false,
    )
    assert.deepEqual(await credentials.get(credential.credentialId), credential)
    const revokedCredential: AgentCredentialRecord = {
      ...credential,
      status: 'revoked',
      updatedAt: '2026-05-09T12:02:00.000Z',
    }
    assert.equal(
      await credentials.putIfStatus(revokedCredential, 'active'),
      true,
    )
    assert.deepEqual(await credentials.get(credential.credentialId), revokedCredential)
    assert.deepEqual(await services.get(service.serviceId), service)
    assert.equal(
      await services.putIfUpdatedAt(
        {
          ...service,
          label: 'Should not write',
          updatedAt: '2026-05-09T12:01:00.000Z',
        },
        '2026-05-09T11:59:00.000Z',
      ),
      false,
    )
    assert.deepEqual(await services.get(service.serviceId), service)
    const disabledService: RegisteredPalmosServiceRecord = {
      ...service,
      status: 'disabled',
      updatedAt: '2026-05-09T12:02:00.000Z',
    }
    assert.equal(
      await services.putIfUpdatedAt(disabledService, service.updatedAt),
      true,
    )
    assert.deepEqual(await services.get(service.serviceId), disabledService)
    assert.deepEqual(await paidCalls.get(paidCall.executionId), paidCall)
    assert.deepEqual(await audit.get(auditRecord.auditLogId), auditRecord)
    assert.deepEqual(await readiness.latest(), readinessReport)
    assert.deepEqual(await sessions.get(session.sessionId), session)
    assert.deepEqual(await runs.get(run.runId), run)
    assert.deepEqual(await runs.listBySession(session.sessionId), [run])
    assert.deepEqual(await xmtpAlerts.get(alert.alertId), alert)
    assert.deepEqual(await transcript.list(session.sessionId), [transcriptEntry])
    assert.deepEqual(await ledger.listForRun(run.runId), [ledgerEvent])
    assert.match(artifact.artifactId, /^artifact_/)
    assert.equal(artifact.artifactType, 'report')

    const workspaceFromLoader = loadAgentSpendWorkspace({
      baseDir: '/tmp/palmos-postgres-test',
      env: {
        PALMOS_STORAGE_DRIVER: 'postgres',
        PALMOS_DATABASE_URL: databaseUrl,
      },
    })
    try {
      assert.equal(workspaceFromLoader.storageDriver, 'postgres')
      assert.equal((await workspaceFromLoader.agentRegistry.list()).length, 1)
      assert.equal(
        (await workspaceFromLoader.actionRequestRegistry?.list())?.length,
        2,
      )
    } finally {
      await workspaceFromLoader.postgresPool?.end()
    }
  } finally {
    await truncateTestTables(pool).catch(() => undefined)
    await pool.end()
  }
})
