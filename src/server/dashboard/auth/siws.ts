import { randomBytes } from 'crypto'
import type express from 'express'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import {
  OPERATOR_SESSION_COOKIE,
  buildDashboardAccessCookie,
  readCookie,
  readDashboardSessionIdentity,
  readDashboardWorkspaceId,
  readOperatorSessionSecret,
  signOperatorSession,
  verifyOperatorSession,
  type DashboardAccessIdentity,
  type OperatorSessionPayload,
} from '../access.js'
import { shouldUseCrossSiteCookie } from '../config.js'
import { sendDashboardApiError } from '../apiErrors.js'
import { recordDashboardAudit } from '../audit.js'
import { ensureDashboardWorkspaceRecord } from '../workspaceSettings.js'
import { sanitizeDashboardOperator } from '../operatorLifecycle.js'
import type { DashboardRouteContext } from '../context.js'
import type { DashboardOperatorRecord } from '../../../store/DashboardOperatorRegistry.js'
import { readMaybeString, readRecord } from '../shared.js'

// Sign-In With Solana (SIWS). The operator connects a Solana wallet, signs a
// server-issued nonce, and the backend verifies the ed25519 signature and mints
// a session keyed to that operator. First sign-in creates the operator record
// (+ workspace). See docs/operator-auth-plan.md §3.

const NONCE_TTL_MS = 5 * 60 * 1000 // 5 minutes, single-use
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

type StoredNonce = {
  nonce: string
  message: string
  expiresAt: number
}

// In-memory, single-use nonce store keyed by wallet address. Acceptable for the
// current single-operator / single-instance deployment. NOTE: this must move to
// the registry / Postgres if the API ever runs multi-instance (a nonce issued by
// one instance would not be verifiable by another). See plan §8.
const nonceStore = new Map<string, StoredNonce>()

function readFirstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function readRequestUri(req: express.Request): string {
  const proto =
    readFirstHeader(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim() ||
    req.protocol ||
    'https'
  const host =
    readFirstHeader(req.headers['x-forwarded-host'])?.split(',')[0]?.trim() ||
    readFirstHeader(req.headers.host)
  return host ? `${proto}://${host}` : 'https://app.getpalmos.xyz'
}

function decodePublicKey(address: string): Uint8Array | undefined {
  try {
    const decoded = bs58.decode(address)
    return decoded.length === 32 ? decoded : undefined
  } catch {
    return undefined
  }
}

function buildSiwsMessage(input: {
  address: string
  nonce: string
  uri: string
  issuedAt: string
}): string {
  return [
    'PalmOS wants you to sign in with your Solana account:',
    input.address,
    '',
    'Sign in to the PalmOS operator dashboard. This request will not trigger a blockchain transaction or cost any gas.',
    '',
    `URI: ${input.uri}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
  ].join('\n')
}

export type IssuedNonce = {
  nonce: string
  message: string
  expiresAt: number
}

export function issueNonce(input: {
  address: string
  uri: string
  now?: number
}): IssuedNonce {
  const now = input.now ?? Date.now()
  const nonce = randomBytes(16).toString('hex')
  const issuedAt = new Date(now).toISOString()
  const message = buildSiwsMessage({
    address: input.address,
    nonce,
    uri: input.uri,
    issuedAt,
  })
  const expiresAt = now + NONCE_TTL_MS
  // Overwrites any prior nonce for this address (a fresh request invalidates the old).
  nonceStore.set(input.address, { nonce, message, expiresAt })
  return { nonce, message, expiresAt }
}

export type SiwsVerifyResult =
  | { ok: true; address: string }
  | { ok: false; code: 'nonce_not_found' | 'nonce_expired' | 'invalid_signature' }

// Verifies that `signature` is a valid ed25519 signature, by `address`, over the
// exact server-issued message for the outstanding nonce. The nonce is consumed
// (single-use) on any verification attempt to prevent replay.
export function verifySiws(input: {
  address: string
  signature: string
  now?: number
}): SiwsVerifyResult {
  const now = input.now ?? Date.now()
  const stored = nonceStore.get(input.address)
  if (!stored) {
    return { ok: false, code: 'nonce_not_found' }
  }
  // Single-use: remove now regardless of outcome.
  nonceStore.delete(input.address)

  if (stored.expiresAt <= now) {
    return { ok: false, code: 'nonce_expired' }
  }

  const publicKey = decodePublicKey(input.address)
  if (!publicKey) {
    return { ok: false, code: 'invalid_signature' }
  }

  let signatureBytes: Uint8Array
  try {
    signatureBytes = bs58.decode(input.signature)
  } catch {
    return { ok: false, code: 'invalid_signature' }
  }
  if (signatureBytes.length !== nacl.sign.signatureLength) {
    return { ok: false, code: 'invalid_signature' }
  }

  const messageBytes = Buffer.from(stored.message, 'utf8')
  const verified = nacl.sign.detached.verify(
    messageBytes,
    signatureBytes,
    publicKey,
  )
  if (!verified) {
    return { ok: false, code: 'invalid_signature' }
  }

  return { ok: true, address: input.address }
}

function truncateAddress(address: string): string {
  return address.length > 8
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : address
}

export type UpsertOperatorResult =
  | { ok: true; operator: DashboardOperatorRecord; created: boolean }
  | { ok: false; code: 'operator_disabled' }

// Finds the operator for a wallet address, creating one (and ensuring the
// workspace) on first sign-in. Single operator → single workspace for now; the
// record shape (role + walletAddress) supports adding multi-operator later
// without migration (plan §2).
export async function upsertOperatorByWallet(input: {
  context: DashboardRouteContext
  address: string
  now?: () => string
}): Promise<UpsertOperatorResult> {
  const registry = input.context.workspace.dashboardOperatorRegistry
  const at = input.now?.() ?? new Date().toISOString()
  const existing = await registry.getByWalletAddress(input.address)

  if (existing) {
    if (existing.status === 'disabled') {
      return { ok: false, code: 'operator_disabled' }
    }
    const updated: DashboardOperatorRecord = {
      ...existing,
      updatedAt: at,
      lastLoginAt: at,
    }
    await registry.put(updated)
    return { ok: true, operator: updated, created: false }
  }

  await ensureDashboardWorkspaceRecord({
    registry: input.context.workspace.dashboardWorkspaceRegistry,
    env: input.context.env,
  })

  const operator: DashboardOperatorRecord = {
    operatorId: `op_${input.address}`,
    workspaceId: readDashboardWorkspaceId(input.context.env),
    createdAt: at,
    updatedAt: at,
    displayName: `Operator ${truncateAddress(input.address)}`,
    role: 'owner',
    status: 'active',
    source: 'siws',
    walletAddress: input.address,
    lastLoginAt: at,
  }
  await registry.put(operator)
  return { ok: true, operator, created: true }
}

function auditIdentityFor(
  operator: DashboardOperatorRecord,
): DashboardAccessIdentity {
  return {
    operatorId: operator.operatorId,
    workspaceId: operator.workspaceId,
    actorId: `operator:${operator.operatorId}`,
    role: operator.role,
    source: operator.source,
    expiresAt: Number.MAX_SAFE_INTEGER,
  }
}

export function mintOperatorSession(input: {
  env: DashboardRouteContext['env']
  operator: DashboardOperatorRecord
  now?: number
}): { cookie: string; expiresAt: number } | undefined {
  const secret = readOperatorSessionSecret(input.env)
  if (!secret) {
    return undefined
  }
  const now = input.now ?? Date.now()
  const expiresAt = now + SESSION_TTL_MS
  const payload: OperatorSessionPayload = {
    operatorId: input.operator.operatorId,
    workspaceId: input.operator.workspaceId,
    role: input.operator.role,
    expiresAt,
  }
  const token = signOperatorSession(payload, secret)
  const cookie = buildDashboardAccessCookie({
    name: OPERATOR_SESSION_COOKIE,
    token,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    crossSiteCookie: shouldUseCrossSiteCookie(input.env),
  })
  return { cookie, expiresAt }
}

function buildLogoutCookie(env: DashboardRouteContext['env']): string {
  return buildDashboardAccessCookie({
    name: OPERATOR_SESSION_COOKIE,
    token: '',
    maxAge: 0,
    crossSiteCookie: shouldUseCrossSiteCookie(env),
  })
}

export function registerAuthRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  const env = context.env

  // Issue a single-use nonce + the exact message the wallet must sign.
  app.get('/api/auth/nonce', (req, res) => {
    const address = readMaybeString(req.query.address)
    if (!address || !decodePublicKey(address)) {
      sendDashboardApiError(res, 400, {
        code: 'invalid_address',
        message: 'A valid Solana wallet address is required.',
      })
      return
    }

    const issued = issueNonce({ address, uri: readRequestUri(req) })
    res.json({
      ok: true,
      nonce: issued.nonce,
      message: issued.message,
      expiresAt: issued.expiresAt,
    })
  })

  // Verify the signed nonce, upsert the operator, and mint a session cookie.
  app.post('/api/auth/verify', async (req, res) => {
    const body = readRecord(req.body)
    const address = readMaybeString(body.address)
    const signature = readMaybeString(body.signature)
    if (!address || !signature) {
      sendDashboardApiError(res, 400, {
        code: 'invalid_verify_request',
        message: 'address and signature are required.',
      })
      return
    }

    const verification = verifySiws({ address, signature })
    if (!verification.ok) {
      sendDashboardApiError(res, 401, {
        code: verification.code,
        message: 'Sign-in verification failed.',
      })
      return
    }

    const upsert = await upsertOperatorByWallet({ context, address })
    if (!upsert.ok) {
      sendDashboardApiError(res, 403, {
        code: upsert.code,
        message: 'Operator account is disabled.',
      })
      return
    }

    const session = mintOperatorSession({ env, operator: upsert.operator })
    if (!session) {
      sendDashboardApiError(res, 500, {
        code: 'operator_session_secret_not_configured',
        message: 'PALMOS_SESSION_SECRET is not configured.',
      })
      return
    }

    if (upsert.created) {
      await recordDashboardAudit({
        context,
        identity: auditIdentityFor(upsert.operator),
        action: 'operator.create',
        target: { type: 'operator', id: upsert.operator.operatorId },
        summary: 'Operator created via Sign-In With Solana.',
      })
    }
    await recordDashboardAudit({
      context,
      identity: auditIdentityFor(upsert.operator),
      action: 'operator.signin',
      target: { type: 'operator', id: upsert.operator.operatorId },
      summary: 'Operator signed in with Solana.',
    })

    res.setHeader('Set-Cookie', session.cookie)
    res.json({
      ok: true,
      operator: sanitizeDashboardOperator(upsert.operator),
      expiresAt: session.expiresAt,
    })
  })

  // Return the current operator, or 401. Mirrors the dashboard guard: a valid
  // SIWS session in public mode, or the local-dev bypass in non-public mode.
  app.get('/api/auth/session', async (req, res) => {
    const identity = readDashboardSessionIdentity({
      req,
      env,
      now: Date.now(),
    })
    if (!identity) {
      sendDashboardApiError(res, 401, {
        code: 'no_active_session',
        message: 'No active operator session.',
      })
      return
    }

    const operator = await context.workspace.dashboardOperatorRegistry.get(
      identity.operatorId,
    )
    if (operator) {
      if (operator.status === 'disabled') {
        res.setHeader('Set-Cookie', buildLogoutCookie(env))
        sendDashboardApiError(res, 401, {
          code: 'no_active_session',
          message: 'No active operator session.',
        })
        return
      }
      res.json({ ok: true, operator: sanitizeDashboardOperator(operator) })
      return
    }

    // Local-dev bypass: the env operator has no stored record — synthesize a view.
    res.json({
      ok: true,
      operator: {
        operatorId: identity.operatorId,
        workspaceId: identity.workspaceId,
        displayName: 'Workspace Operator',
        role: identity.role,
        status: 'active',
        source: identity.source,
        walletAddress: undefined,
        email: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        lastLoginAt: undefined,
      },
    })
  })

  // Clear the session cookie.
  app.post('/api/auth/logout', async (req, res) => {
    const payload = verifyOperatorSession(
      readCookie(req, OPERATOR_SESSION_COOKIE),
      readOperatorSessionSecret(env),
      Date.now(),
    )
    res.setHeader('Set-Cookie', buildLogoutCookie(env))

    if (payload) {
      await recordDashboardAudit({
        context,
        identity: {
          operatorId: payload.operatorId,
          workspaceId: payload.workspaceId,
          actorId: `operator:${payload.operatorId}`,
          role: payload.role,
          source: 'siws',
          expiresAt: payload.expiresAt,
        },
        action: 'operator.signout',
        target: { type: 'operator', id: payload.operatorId },
        summary: 'Operator signed out.',
      })
    }

    res.json({ ok: true })
  })
}
