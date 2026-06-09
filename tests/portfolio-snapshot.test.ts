import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import {
  FilePortfolioSnapshotRegistry,
  InMemoryPortfolioSnapshotRegistry,
  type PortfolioSnapshotRecord,
} from '../src/store/PortfolioSnapshotRegistry.js'
import { PostgresPortfolioSnapshotRegistry } from '../src/storage/postgres/registries.js'
import { capturePortfolioSnapshot } from '../src/app/capturePortfolioSnapshot.js'
import type { AgentRecord } from '../src/store/AgentRegistry.js'
import type { WalletRecord } from '../runtime/contracts/wallet.js'
import type {
  PortfolioReader,
  WalletPortfolioSnapshot,
} from '../src/integrations/portfolio/types.js'
import { signDashboardAccessExpiry } from '../src/server/dashboard/access.js'
import { registerPortfolioHistoryRoutes } from '../src/server/dashboard/routes/portfolioHistoryRoutes.js'

function createSnapshot(
  overrides: Partial<PortfolioSnapshotRecord> = {},
): PortfolioSnapshotRecord {
  return {
    snapshotId: 'portfolio_snapshot_1',
    agentId: 'agent_alpha',
    walletId: 'wallet_alpha',
    address: 'AlphaWallet111',
    chainId: 'solana-mainnet',
    capturedAt: '2026-06-09T10:00:00.000Z',
    totalValueUsd: 145.5,
    positionsCount: 2,
    positions: [
      { symbol: 'PUSD', chainId: 'solana-mainnet', quantity: 125.5, value: 125.5 },
      { symbol: 'wSOL', chainId: 'solana-mainnet', quantity: 0.1, value: 20 },
    ],
    syncKind: 'synced',
    syncMessage: 'Synced on solana-mainnet.',
    ...overrides,
  }
}

function createAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: 'agent_alpha',
    walletId: 'wallet_alpha',
    policyConfig: {
      allowedChains: ['solana-mainnet'],
    },
    ...overrides,
  } as never
}

function createWallet(overrides: Partial<WalletRecord> = {}): WalletRecord {
  return {
    walletId: 'wallet_alpha',
    address: 'AlphaWallet111',
    ...overrides,
  } as never
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
      return { statusCode, body }
    },
  }
}

test('InMemoryPortfolioSnapshotRegistry round-trips and lists newest-first per agent', async () => {
  const registry = new InMemoryPortfolioSnapshotRegistry()
  await registry.put(
    createSnapshot({
      snapshotId: 'snap_old',
      capturedAt: '2026-06-09T09:00:00.000Z',
    }),
  )
  await registry.put(
    createSnapshot({
      snapshotId: 'snap_new',
      capturedAt: '2026-06-09T11:00:00.000Z',
    }),
  )
  await registry.put(
    createSnapshot({
      snapshotId: 'snap_other_agent',
      agentId: 'agent_beta',
      capturedAt: '2026-06-09T12:00:00.000Z',
    }),
  )

  assert.equal((await registry.get('snap_new'))?.snapshotId, 'snap_new')

  const history = await registry.listByAgent('agent_alpha')
  assert.deepEqual(
    history.map((record) => record.snapshotId),
    ['snap_new', 'snap_old'],
  )

  const limited = await registry.listByAgent('agent_alpha', { limit: 1 })
  assert.equal(limited.length, 1)
  assert.equal(limited[0]?.snapshotId, 'snap_new')

  assert.equal((await registry.latestForAgent('agent_alpha'))?.snapshotId, 'snap_new')
  assert.equal(await registry.latestForAgent('agent_unknown'), undefined)
})

test('FilePortfolioSnapshotRegistry persists and lists newest-first per agent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'palmos-portfolio-snapshot-'))
  try {
    const registry = new FilePortfolioSnapshotRegistry(dir)
    await registry.put(
      createSnapshot({
        snapshotId: 'snap_a',
        capturedAt: '2026-06-09T09:00:00.000Z',
      }),
    )
    await registry.put(
      createSnapshot({
        snapshotId: 'snap_b',
        capturedAt: '2026-06-09T10:30:00.000Z',
      }),
    )
    await registry.put(
      createSnapshot({
        snapshotId: 'snap_beta',
        agentId: 'agent_beta',
        capturedAt: '2026-06-09T11:00:00.000Z',
      }),
    )

    const restored = await registry.get('snap_b')
    assert.equal(restored?.snapshotId, 'snap_b')
    assert.equal(restored?.totalValueUsd, 145.5)
    assert.equal(restored?.positions.length, 2)

    const history = await registry.listByAgent('agent_alpha')
    assert.deepEqual(
      history.map((record) => record.snapshotId),
      ['snap_b', 'snap_a'],
    )

    assert.equal(
      (await registry.latestForAgent('agent_alpha'))?.snapshotId,
      'snap_b',
    )
    assert.equal(await registry.get('snap_missing'), undefined)
    assert.deepEqual(await registry.listByAgent('agent_unknown'), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('capturePortfolioSnapshot maps a live read and persists the snapshot', async () => {
  const registry = new InMemoryPortfolioSnapshotRegistry()
  const liveSnapshot: WalletPortfolioSnapshot = {
    address: 'AlphaWallet111',
    positions: [
      { id: 'p1', symbol: 'PUSD', chainId: 'solana-mainnet', quantity: 12.5, value: 12.5 },
      // No USD value (no price oracle) — must be excluded from the total.
      { id: 'p2', symbol: 'SOL', chainId: 'solana-mainnet', quantity: 1.2 },
    ],
    transactions: [
      {
        id: 't1',
        hash: 't1',
        chainId: 'solana-mainnet',
        minedAt: '2026-06-09T00:00:00.000Z',
      },
    ],
    sync: { kind: 'synced', chainId: 'solana-mainnet', message: 'Synced.' },
  }
  let requestedAddress: string | undefined
  let requestedChainId: string | undefined
  const portfolioReader: PortfolioReader = {
    async getWalletSnapshot(address, options) {
      requestedAddress = address
      requestedChainId = options?.chainId
      return liveSnapshot
    },
  }

  const record = await capturePortfolioSnapshot({
    agent: createAgent(),
    wallet: createWallet(),
    portfolioReader,
    registry,
    now: () => '2026-06-09T10:00:00.000Z',
    createId: (prefix) => `${prefix}_test`,
  })

  assert.equal(requestedAddress, 'AlphaWallet111')
  assert.equal(requestedChainId, 'solana-mainnet')
  assert.equal(record.snapshotId, 'portfolio_snapshot_test')
  assert.equal(record.agentId, 'agent_alpha')
  assert.equal(record.walletId, 'wallet_alpha')
  assert.equal(record.address, 'AlphaWallet111')
  assert.equal(record.chainId, 'solana-mainnet')
  assert.equal(record.capturedAt, '2026-06-09T10:00:00.000Z')
  assert.equal(record.totalValueUsd, 12.5)
  assert.equal(record.positionsCount, 2)
  assert.equal(record.positions[1]?.symbol, 'SOL')
  assert.equal(record.positions[1]?.value, undefined)
  assert.equal(record.syncKind, 'synced')
  assert.equal(record.syncMessage, 'Synced.')

  // Persisted, not just returned.
  assert.deepEqual(await registry.get('portfolio_snapshot_test'), record)
})

test('PostgresPortfolioSnapshotRegistry reads agent history newest-first with a limit', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = []
  const stored = createSnapshot({ snapshotId: 'snap_pg' })
  const pool = {
    query: async <T>(sql: string, params: unknown[] = []) => {
      queries.push({ sql, params })
      if (sql.includes('select record from portfolio_snapshots where agent_id = $1')) {
        return { rowCount: 1, rows: [{ record: stored }] } as {
          rowCount: number
          rows: T[]
        }
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
  }

  const registry = new PostgresPortfolioSnapshotRegistry(pool as never)
  const history = await registry.listByAgent('agent_alpha', { limit: 5 })

  assert.equal(history.length, 1)
  assert.equal(history[0]?.snapshotId, 'snap_pg')
  assert.equal(queries.length, 1)
  assert.ok(queries[0]?.sql.includes('order by captured_at desc, snapshot_id desc'))
  assert.ok(queries[0]?.sql.includes('limit $2'))
  assert.deepEqual(queries[0]?.params, ['agent_alpha', 5])
})

test('PostgresPortfolioSnapshotRegistry put denormalizes columns alongside the jsonb record', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = []
  const pool = {
    query: async <T>(sql: string, params: unknown[] = []) => {
      queries.push({ sql, params })
      return { rowCount: 1, rows: [] } as { rowCount: number; rows: T[] }
    },
  }

  const registry = new PostgresPortfolioSnapshotRegistry(pool as never)
  const record = createSnapshot({ snapshotId: 'snap_put' })
  await registry.put(record)

  assert.equal(queries.length, 1)
  assert.ok(queries[0]?.sql.includes('insert into portfolio_snapshots'))
  assert.ok(queries[0]?.sql.includes('on conflict (snapshot_id) do update set'))
  assert.deepEqual(queries[0]?.params, [
    'snap_put',
    'agent_alpha',
    'wallet_alpha',
    'AlphaWallet111',
    'solana-mainnet',
    '2026-06-09T10:00:00.000Z',
    145.5,
    2,
    JSON.stringify(record),
  ])
})

test('dashboard portfolio history route requires access and returns snapshots newest-first', async () => {
  const operatorSecret = 'operator-session-secret'
  const token = signDashboardAccessExpiry(Date.now() + 60_000, operatorSecret)
  const agent = createAgent()
  const portfolioSnapshotRegistry = new InMemoryPortfolioSnapshotRegistry([
    createSnapshot({
      snapshotId: 'snap_old',
      capturedAt: '2026-06-09T09:00:00.000Z',
    }),
    createSnapshot({
      snapshotId: 'snap_new',
      capturedAt: '2026-06-09T11:00:00.000Z',
    }),
  ])

  const app = express()
  registerPortfolioHistoryRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_OPERATOR_SESSION_SECRET: operatorSecret,
        PALMOS_OPERATOR_ROLE: 'operator',
      },
      workspace: {
        agentRegistry: {
          async get(agentId: string) {
            return agentId === agent.agentId ? agent : undefined
          },
        },
      },
      portfolioSnapshotRegistry,
    } as never,
  )

  const layer = app.router.stack.find(
    (entry) =>
      entry.route?.path ===
      '/api/dashboard/agents/:agentId/portfolio-history',
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function')

  const deniedResponse = createMockResponse()
  await handler(
    {
      headers: {},
      params: { agentId: agent.agentId },
      query: {},
      method: 'GET',
      path: `/api/dashboard/agents/${agent.agentId}/portfolio-history`,
    } as never,
    deniedResponse.res as never,
  )
  assert.equal(deniedResponse.read().statusCode, 401)

  const allowedResponse = createMockResponse()
  await handler(
    {
      headers: {
        cookie: `palmos_operator_access=${encodeURIComponent(token)}`,
      },
      params: { agentId: agent.agentId },
      query: {},
      method: 'GET',
      path: `/api/dashboard/agents/${agent.agentId}/portfolio-history`,
    } as never,
    allowedResponse.res as never,
  )

  const result = allowedResponse.read()
  assert.equal(result.statusCode, 200)
  const body = result.body as {
    ok: boolean
    agentId: string
    limit: number
    snapshots: PortfolioSnapshotRecord[]
  }
  assert.equal(body.ok, true)
  assert.equal(body.agentId, agent.agentId)
  assert.equal(body.snapshots.length, 2)
  assert.equal(body.snapshots[0]?.snapshotId, 'snap_new')
  assert.equal(body.snapshots[1]?.snapshotId, 'snap_old')
})

test('dashboard portfolio history route returns 404 for an unknown agent', async () => {
  const operatorSecret = 'operator-session-secret'
  const token = signDashboardAccessExpiry(Date.now() + 60_000, operatorSecret)

  const app = express()
  registerPortfolioHistoryRoutes(
    app,
    {
      env: {
        PALMOS_PUBLIC_ACCESS_MODE: '1',
        PALMOS_OPERATOR_SESSION_SECRET: operatorSecret,
        PALMOS_OPERATOR_ROLE: 'operator',
      },
      workspace: {
        agentRegistry: {
          async get() {
            return undefined
          },
        },
      },
      portfolioSnapshotRegistry: new InMemoryPortfolioSnapshotRegistry(),
    } as never,
  )

  const layer = app.router.stack.find(
    (entry) =>
      entry.route?.path ===
      '/api/dashboard/agents/:agentId/portfolio-history',
  )
  const handler = layer?.route?.stack?.[0]?.handle

  const response = createMockResponse()
  await handler(
    {
      headers: {
        cookie: `palmos_operator_access=${encodeURIComponent(token)}`,
      },
      params: { agentId: 'agent_missing' },
      query: {},
      method: 'GET',
      path: '/api/dashboard/agents/agent_missing/portfolio-history',
    } as never,
    response.res as never,
  )

  assert.equal(response.read().statusCode, 404)
})
