import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FileActionRequestRegistry,
  InMemoryActionRequestRegistry,
  type ActionRequestRegistry,
} from '../src/store/ActionRequestRegistry.js'
import { reconcilePaidCallActionRequests } from '../src/app/reconcileActionRequests.js'
import type { PaidCallRecord } from '../src/store/PaidCallRegistry.js'
import { FilePaidCallRegistry } from '../src/store/PaidCallRegistry.js'
import { mapPaidCallToActionRequest } from '../src/store/mapPaidCallToActionRequest.js'
import {
  PostgresActionRequestRegistry,
  PostgresPaidCallRegistry,
} from '../src/storage/postgres/registries.js'

function createPaidCall(
  overrides: Partial<PaidCallRecord> = {},
): PaidCallRecord {
  return {
    executionId: 'paid_call_action_request_test',
    createdAt: '2026-06-03T10:00:00.000Z',
    updatedAt: '2026-06-03T10:00:00.000Z',
    agentId: 'agent_test',
    serviceId: 'service.research',
    vendorId: 'vendor_research',
    paymentRail: 'palmos-pusd',
    settlementMode: 'local-demo',
    amount: '2.5',
    assetSymbol: 'PUSD',
    chainId: 'solana-mainnet',
    status: 'approval_pending',
    runId: 'run_test',
    sessionId: 'session_test',
    walletId: 'wallet_test',
    runtimeStatus: 'waiting_for_approval',
    requestPayload: {
      prompt: 'Find the latest market structure update.',
    },
    requestSummary: {
      topic: 'market-structure',
    },
    requestUrl: 'https://api.example.com/research',
    ...overrides,
  }
}

test('mapPaidCallToActionRequest keeps approval policy context across updates', async () => {
  const pending = createPaidCall()
  const initial = mapPaidCallToActionRequest(pending)

  assert.equal(initial.actionRequestId, pending.executionId)
  assert.equal(initial.kind, 'service.pay')
  assert.equal(initial.status, 'approval_pending')
  assert.equal(initial.policy.approvalRequired, true)
  assert.equal(initial.executionPlan?.connectorKind, 'pusd')
  assert.equal(initial.runtimeRefs?.runId, pending.runId)

  const executed = mapPaidCallToActionRequest(
    {
      ...pending,
      status: 'executed',
      updatedAt: '2026-06-03T10:05:00.000Z',
      runtimeStatus: 'completed',
      transactionSignature: 'sig_test',
    },
    initial,
  )

  assert.equal(executed.status, 'executed')
  assert.equal(executed.policy.approvalRequired, true)
  assert.equal(executed.resultRef, 'sig_test')
})

test('FilePaidCallRegistry mirrors PaidCall lifecycle into ActionRequest storage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-action-request-'))
  try {
    const actionRequests = new FileActionRequestRegistry(dir)
    const paidCalls = new FilePaidCallRegistry(dir, actionRequests)
    const record = createPaidCall()

    await paidCalls.put(record)

    const mirroredPending = await actionRequests.get(record.executionId)
    assert.equal(mirroredPending?.status, 'approval_pending')
    assert.equal(mirroredPending?.policy.approvalRequired, true)

    const waitingRecord: PaidCallRecord = {
      ...record,
      status: 'waiting_for_execution',
      updatedAt: '2026-06-03T10:02:00.000Z',
      runtimeStatus: 'waiting_for_signature',
    }
    const claimed = await paidCalls.putIfStatus(waitingRecord, 'approval_pending')
    assert.equal(claimed, true)

    const mirroredWaiting = await actionRequests.get(record.executionId)
    assert.equal(mirroredWaiting?.status, 'waiting_for_execution')
    assert.equal(mirroredWaiting?.policy.approvalRequired, true)

    await paidCalls.remove(record.executionId)
    assert.equal(await actionRequests.get(record.executionId), undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('InMemoryActionRequestRegistry works with mapped PaidCall records', async () => {
  const registry = new InMemoryActionRequestRegistry()
  const mapped = mapPaidCallToActionRequest(
    createPaidCall({
      status: 'failed',
      errorCode: 'palmos.execution_failed',
      errorMessage: 'Service execution failed.',
    }),
  )

  await registry.put(mapped)
  assert.deepEqual(await registry.get(mapped.actionRequestId), mapped)
})

test('FileActionRequestRegistry query filters, sorts, and summarizes matching records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-action-request-query-'))
  try {
    const registry = new FileActionRequestRegistry(dir)
    await registry.put(
      mapPaidCallToActionRequest(
        createPaidCall({
          executionId: 'paid_call_query_1',
          updatedAt: '2026-06-03T10:01:00.000Z',
          requestSource: 'sdk',
          status: 'approval_pending',
        }),
      ),
    )
    await registry.put(
      mapPaidCallToActionRequest(
        createPaidCall({
          executionId: 'paid_call_query_2',
          updatedAt: '2026-06-03T10:03:00.000Z',
          requestSource: 'sdk',
          status: 'failed',
          errorCode: 'quote_expired',
        }),
      ),
    )
    await registry.put(
      mapPaidCallToActionRequest(
        createPaidCall({
          executionId: 'paid_call_query_3',
          agentId: 'agent_other',
          updatedAt: '2026-06-03T10:05:00.000Z',
          requestSource: 'worker',
          status: 'executed',
        }),
      ),
    )

    const result = await registry.query({
      agentId: 'agent_test',
      source: 'sdk',
      limit: 1,
    })

    assert.equal(result.records.length, 1)
    assert.equal(result.records[0]?.actionRequestId, 'paid_call_query_2')
    assert.equal(result.summary.totalMatching, 2)
    assert.equal(result.summary.byStatus.failed, 1)
    assert.equal(result.summary.byStatus.approval_pending, 1)
    assert.equal(result.summary.bySource.sdk, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('FileActionRequestRegistry normalizes legacy records without source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-action-request-legacy-'))
  try {
    const registry = new FileActionRequestRegistry(dir)
    const legacyRecord = mapPaidCallToActionRequest(
      createPaidCall({
        executionId: 'paid_call_legacy_source',
        updatedAt: '2026-06-03T10:07:00.000Z',
      }),
    )
    const { source: _source, ...withoutSource } = legacyRecord

    await mkdir(join(dir, 'action-requests'), { recursive: true })
    await writeFile(
      join(dir, 'action-requests', 'paid_call_legacy_source.json'),
      JSON.stringify(withoutSource, null, 2),
      'utf8',
    )

    const restored = await registry.get('paid_call_legacy_source')
    assert.equal(restored?.source, 'system')

    const result = await registry.query({
      source: 'system',
      limit: 1,
    })
    assert.equal(result.records.length, 1)
    assert.equal(result.records[0]?.source, 'system')
    assert.equal(result.summary.bySource.system, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('mapPaidCallToActionRequest prefers inferred provenance over legacy system defaults', () => {
  const sdkMapped = mapPaidCallToActionRequest(
    createPaidCall({
      executionId: 'paid_call_idem_sdk_retry',
    }),
    {
      ...mapPaidCallToActionRequest(createPaidCall()),
      source: 'system',
    },
  )
  assert.equal(sdkMapped.source, 'sdk')

  const workerMapped = mapPaidCallToActionRequest(
    createPaidCall({
      requestSource: 'worker',
    }),
  )
  assert.equal(workerMapped.source, 'worker')
})

test('PostgresActionRequestRegistry query uses filtered reads and summary aggregation', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = []
  const actionRequest = mapPaidCallToActionRequest(
    createPaidCall({
      executionId: 'paid_call_pg_query',
      updatedAt: '2026-06-03T10:09:00.000Z',
      requestSource: 'sdk',
      status: 'executed',
    }),
  )
  const { source: _source, ...legacyActionRequest } = actionRequest
  let released = false
  const client = {
    query: async <T>(sql: string, params: unknown[] = []) => {
      queries.push({ sql, params })
      if (sql === 'begin isolation level repeatable read read only') {
        return {
          rowCount: 0,
          rows: [],
        } as { rowCount: number; rows: T[] }
      }
      if (sql === 'commit' || sql === 'rollback') {
        return {
          rowCount: 0,
          rows: [],
        } as { rowCount: number; rows: T[] }
      }
      if (sql.includes('select record, source from action_requests')) {
        return {
          rowCount: 1,
          rows: [{ record: legacyActionRequest, source: 'sdk' }],
        } as { rowCount: number; rows: T[] }
      }
      if (sql.includes('with filtered as')) {
        return {
          rowCount: 1,
          rows: [
            {
              total_matching: 3,
              by_status: { executed: 2, failed: 1 },
              by_kind: { 'service.pay': 3 },
              by_source: { sdk: 3 },
            },
          ],
        } as { rowCount: number; rows: T[] }
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
    release: () => {
      released = true
    },
  }
  const pool = {
    connect: async () => client,
  }

  const registry = new PostgresActionRequestRegistry(pool as never)
  const result = await registry.query({
    agentId: 'agent_test',
    source: 'sdk',
    limit: 1,
  })

  assert.equal(result.records.length, 1)
  assert.equal(result.records[0]?.actionRequestId, 'paid_call_pg_query')
  assert.equal(result.records[0]?.source, 'sdk')
  assert.equal(result.summary.totalMatching, 3)
  assert.equal(result.summary.byStatus.executed, 2)
  assert.equal(result.summary.byKind['service.pay'], 3)
  assert.equal(result.summary.bySource.sdk, 3)
  assert.equal(queries.length, 4)
  assert.equal(queries[0]?.sql, 'begin isolation level repeatable read read only')
  assert.ok(queries[1]?.sql.includes('order by updated_at desc'))
  assert.ok(queries[1]?.sql.includes('source = $2'))
  assert.equal(queries[1]?.sql.includes('record->>\'source\''), false)
  assert.deepEqual(queries[1]?.params, ['agent_test', 'sdk', 1])
  assert.ok(queries[2]?.sql.includes('with filtered as'))
  assert.equal(queries[2]?.sql.includes('record->>\'source\''), false)
  assert.deepEqual(queries[2]?.params, ['agent_test', 'sdk'])
  assert.equal(queries[3]?.sql, 'commit')
  assert.equal(released, true)
})

test('FilePaidCallRegistry keeps PaidCall durable when shadow mirror fails and reconcile backfills it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-action-request-drift-'))
  try {
    const failingActionRequests: ActionRequestRegistry = {
      get: async () => undefined,
      put: async () => {
        throw new Error('shadow mirror unavailable')
      },
      putIfStatus: async () => false,
      query: async () => ({
        records: [],
        summary: {
          totalMatching: 0,
          byStatus: {},
          byKind: {},
          bySource: {},
        },
      }),
      list: async () => [],
      remove: async () => undefined,
    }
    const paidCalls = new FilePaidCallRegistry(dir, failingActionRequests)
    const record = createPaidCall({
      requestSource: 'worker',
    })

    await paidCalls.put(record)
    assert.deepEqual(await paidCalls.get(record.executionId), record)

    const actionRequests = new FileActionRequestRegistry(dir)
    const result = await reconcilePaidCallActionRequests({
      paidCalls: new FilePaidCallRegistry(dir, actionRequests),
      actionRequests,
    })

    assert.equal(result.created, 1)
    assert.equal(result.updated, 0)
    assert.equal(
      (await actionRequests.get(record.executionId))?.source,
      'worker',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('reconcilePaidCallActionRequests removes orphan legacy shadow records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-action-request-orphan-'))
  try {
    const actionRequests = new FileActionRequestRegistry(dir)
    const paidCalls = new FilePaidCallRegistry(dir, actionRequests)
    const orphan = mapPaidCallToActionRequest(
      createPaidCall({
        executionId: 'paid_call_orphan_shadow',
        requestSource: 'sdk',
      }),
    )

    await actionRequests.put(orphan)

    const result = await reconcilePaidCallActionRequests({
      paidCalls,
      actionRequests,
    })

    assert.equal(result.deleted, 1)
    assert.equal(await actionRequests.get(orphan.actionRequestId), undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('PostgresPaidCallRegistry rolls back when the ActionRequest mirror write fails', async () => {
  const queries: string[] = []
  let released = false
  const client = {
    query: async (sql: string) => {
      queries.push(sql)
      if (sql === 'begin' || sql === 'rollback') {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('insert into paid_calls')) {
        return { rowCount: 1, rows: [] }
      }
      if (sql.includes('select record, source from action_requests')) {
        return { rowCount: 0, rows: [] }
      }
      if (sql.includes('insert into action_requests')) {
        throw new Error('mirror write failed')
      }
      if (sql === 'commit') {
        return { rowCount: 0, rows: [] }
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
    release: () => {
      released = true
    },
  }
  const pool = {
    connect: async () => client,
  }

  const registry = new PostgresPaidCallRegistry(pool as never)
  await assert.rejects(
    () => registry.put(createPaidCall()),
    /mirror write failed/,
  )

  assert.equal(queries[0], 'begin')
  assert.ok(queries.some((sql) => sql.includes('insert into paid_calls')))
  assert.ok(
    queries.some((sql) => sql.includes('select record, source from action_requests')),
  )
  assert.ok(
    queries.some((sql) => sql.includes('insert into action_requests')),
  )
  assert.equal(queries.includes('commit'), false)
  assert.equal(queries.at(-1), 'rollback')
  assert.equal(released, true)
})
