import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import {
  issueNonce,
  mintOperatorSession,
  registerAuthRoutes,
  upsertOperatorByWallet,
  verifySiws,
} from '../src/server/dashboard/auth/siws.js'
import {
  OPERATOR_SESSION_COOKIE,
  readDashboardAccessIdentity,
  signOperatorSession,
  verifyOperatorSession,
} from '../src/server/dashboard/access.js'
import { InMemoryDashboardOperatorRegistry } from '../src/store/DashboardOperatorRegistry.js'
import { InMemoryDashboardWorkspaceRegistry } from '../src/store/DashboardWorkspaceRegistry.js'
import { InMemoryDashboardAuditLogRegistry } from '../src/store/DashboardAuditLogRegistry.js'

function createKeypair() {
  const keypair = nacl.sign.keyPair()
  const address = bs58.encode(keypair.publicKey)
  const sign = (message: string) =>
    bs58.encode(nacl.sign.detached(Buffer.from(message, 'utf8'), keypair.secretKey))
  return { address, sign, keypair }
}

function createMockResponse() {
  let statusCode = 200
  let body: unknown
  const headers: Record<string, string> = {}
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
    setHeader(name: string, value: string) {
      headers[name] = value
      return this
    },
  }
  return {
    res,
    read() {
      return { statusCode, body, headers }
    },
  }
}

function findHandler(app: express.Express, path: string) {
  const layer = app.router.stack.find(
    (entry: { route?: { path?: string } }) => entry.route?.path === path,
  )
  const handler = layer?.route?.stack?.[0]?.handle
  assert.equal(typeof handler, 'function', `handler for ${path}`)
  return handler as (req: unknown, res: unknown) => unknown | Promise<unknown>
}

function buildContext() {
  return {
    env: {
      PALMOS_PUBLIC_ACCESS_MODE: '1',
      PALMOS_SESSION_SECRET: 'test-session-secret',
      PALMOS_WORKSPACE_ID: 'palmos_workspace_default',
    },
    workspace: {
      dashboardOperatorRegistry: new InMemoryDashboardOperatorRegistry(),
      dashboardWorkspaceRegistry: new InMemoryDashboardWorkspaceRegistry(),
      dashboardAuditLogRegistry: new InMemoryDashboardAuditLogRegistry(),
    },
  }
}

test('verifySiws accepts a valid signature and is single-use', () => {
  const wallet = createKeypair()
  const issued = issueNonce({ address: wallet.address, uri: 'https://app.test' })
  const signature = wallet.sign(issued.message)

  const first = verifySiws({ address: wallet.address, signature })
  assert.deepEqual(first, { ok: true, address: wallet.address })

  // Replaying the same signature fails — the nonce was consumed.
  const second = verifySiws({ address: wallet.address, signature })
  assert.deepEqual(second, { ok: false, code: 'nonce_not_found' })
})

test('verifySiws rejects an expired nonce', () => {
  const wallet = createKeypair()
  const issued = issueNonce({
    address: wallet.address,
    uri: 'https://app.test',
    now: Date.now() - 10 * 60 * 1000,
  })
  const signature = wallet.sign(issued.message)

  const result = verifySiws({ address: wallet.address, signature })
  assert.deepEqual(result, { ok: false, code: 'nonce_expired' })
})

test('verifySiws rejects a signature over the wrong message', () => {
  const wallet = createKeypair()
  issueNonce({ address: wallet.address, uri: 'https://app.test' })
  const signature = wallet.sign('not the issued message')

  const result = verifySiws({ address: wallet.address, signature })
  assert.deepEqual(result, { ok: false, code: 'invalid_signature' })
})

test('operator session cookie round-trips and is tamper/expiry-protected', () => {
  const now = Date.parse('2026-06-10T12:00:00.000Z')
  const payload = {
    operatorId: 'op_test',
    workspaceId: 'ws_test',
    role: 'owner' as const,
    expiresAt: now + 60_000,
  }
  const token = signOperatorSession(payload, 'secret')

  assert.deepEqual(verifyOperatorSession(token, 'secret', now), payload)
  assert.equal(verifyOperatorSession(token, 'wrong-secret', now), undefined)
  assert.equal(verifyOperatorSession(`${token}x`, 'secret', now), undefined)
  // Expired
  assert.equal(
    verifyOperatorSession(token, 'secret', payload.expiresAt + 1),
    undefined,
  )
})

test('readDashboardAccessIdentity resolves a valid SIWS session in public mode', () => {
  const now = Date.parse('2026-06-10T12:00:00.000Z')
  const env = {
    PALMOS_PUBLIC_ACCESS_MODE: '1',
    PALMOS_SESSION_SECRET: 'secret',
  }
  const token = signOperatorSession(
    {
      operatorId: 'op_abc',
      workspaceId: 'ws_abc',
      role: 'owner',
      expiresAt: now + 60_000,
    },
    'secret',
  )
  const req = {
    headers: { cookie: `${OPERATOR_SESSION_COOKIE}=${encodeURIComponent(token)}` },
  } as never

  const identity = readDashboardAccessIdentity({ req, env, now })
  assert.equal(identity?.operatorId, 'op_abc')
  assert.equal(identity?.role, 'owner')
  assert.equal(identity?.source, 'siws')
  assert.equal(identity?.actorId, 'operator:op_abc')

  // No session cookie → no identity (guard would 401 in public mode).
  assert.equal(
    readDashboardAccessIdentity({ req: { headers: {} } as never, env, now }),
    undefined,
  )
})

test('upsertOperatorByWallet creates an owner on first sign-in, reuses it after', async () => {
  const context = buildContext()
  const wallet = createKeypair()

  const created = await upsertOperatorByWallet({
    context: context as never,
    address: wallet.address,
  })
  assert.equal(created.ok, true)
  assert.equal(created.ok && created.created, true)
  assert.equal(created.ok && created.operator.role, 'owner')
  assert.equal(created.ok && created.operator.source, 'siws')
  assert.equal(created.ok && created.operator.walletAddress, wallet.address)

  const again = await upsertOperatorByWallet({
    context: context as never,
    address: wallet.address,
  })
  assert.equal(again.ok && again.created, false)
  assert.equal(
    created.ok && again.ok && again.operator.operatorId,
    created.operator.operatorId,
  )

  const operators = await context.workspace.dashboardOperatorRegistry.list()
  assert.equal(operators.length, 1)
})

test('mintOperatorSession returns undefined when the session secret is missing', () => {
  const session = mintOperatorSession({
    env: { PALMOS_PUBLIC_ACCESS_MODE: '1' },
    operator: {
      operatorId: 'op_x',
      workspaceId: 'ws_x',
      createdAt: 'now',
      updatedAt: 'now',
      displayName: 'x',
      role: 'owner',
      status: 'active',
      source: 'siws',
    },
  })
  assert.equal(session, undefined)
})

test('auth routes: nonce → verify creates operator + session, session, logout', async () => {
  const context = buildContext()
  const app = express()
  registerAuthRoutes(app, context as never)
  const wallet = createKeypair()

  // 1. nonce
  const nonceRes = createMockResponse()
  await findHandler(app, '/api/auth/nonce')(
    { method: 'GET', path: '/api/auth/nonce', query: { address: wallet.address }, headers: {} },
    nonceRes.res,
  )
  const nonceBody = nonceRes.read().body as { ok: boolean; message: string }
  assert.equal(nonceBody.ok, true)
  assert.ok(nonceBody.message.includes(wallet.address))

  // 2. verify
  const signature = wallet.sign(nonceBody.message)
  const verifyRes = createMockResponse()
  await findHandler(app, '/api/auth/verify')(
    {
      method: 'POST',
      path: '/api/auth/verify',
      body: { address: wallet.address, signature },
      headers: {},
    },
    verifyRes.res,
  )
  const verified = verifyRes.read()
  assert.equal(verified.statusCode, 200)
  assert.equal((verified.body as { ok: boolean }).ok, true)
  assert.equal(
    (verified.body as { operator: { walletAddress: string } }).operator.walletAddress,
    wallet.address,
  )
  const setCookie = verified.headers['Set-Cookie']
  assert.ok(setCookie?.startsWith(`${OPERATOR_SESSION_COOKIE}=`))
  const cookiePair = setCookie.split(';')[0]

  // operator + audit trail were written
  const operator = await context.workspace.dashboardOperatorRegistry.getByWalletAddress(
    wallet.address,
  )
  assert.equal(operator?.role, 'owner')
  const auditActions = (
    await context.workspace.dashboardAuditLogRegistry.list()
  ).map((entry) => entry.action)
  assert.ok(auditActions.includes('operator.create'))
  assert.ok(auditActions.includes('operator.signin'))

  // 3. session (with cookie)
  const sessionRes = createMockResponse()
  await findHandler(app, '/api/auth/session')(
    { method: 'GET', path: '/api/auth/session', headers: { cookie: cookiePair }, query: {} },
    sessionRes.res,
  )
  const sessionRead = sessionRes.read()
  assert.equal(sessionRead.statusCode, 200)
  assert.equal(
    (sessionRead.body as { operator: { walletAddress: string } }).operator.walletAddress,
    wallet.address,
  )

  // session without cookie → 401
  const noSessionRes = createMockResponse()
  await findHandler(app, '/api/auth/session')(
    { method: 'GET', path: '/api/auth/session', headers: {}, query: {} },
    noSessionRes.res,
  )
  assert.equal(noSessionRes.read().statusCode, 401)

  // 4. logout clears the cookie
  const logoutRes = createMockResponse()
  await findHandler(app, '/api/auth/logout')(
    { method: 'POST', path: '/api/auth/logout', headers: { cookie: cookiePair }, body: {} },
    logoutRes.res,
  )
  const logoutRead = logoutRes.read()
  assert.equal((logoutRead.body as { ok: boolean }).ok, true)
  assert.ok(logoutRead.headers['Set-Cookie']?.includes('Max-Age=0'))
})
