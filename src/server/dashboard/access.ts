import { createHmac, timingSafeEqual } from 'crypto'
import type express from 'express'
import type {
  DashboardOperatorRecord,
  DashboardOperatorRole,
} from '../../store/DashboardOperatorRegistry.js'
import { isPublicAccessMode } from './config.js'
import type { DashboardRouteContext } from './context.js'
import { sendDashboardApiError } from './apiErrors.js'
import type { Env } from './shared.js'

export const OPERATOR_SESSION_COOKIE = 'palmos_operator_session'
const DEV_SESSION_SECRET = 'palmos-local-dev-session-secret'

export type DashboardAccessIdentity = {
  operatorId: string
  workspaceId: string
  actorId: string
  role: DashboardOperatorRole
  source: DashboardOperatorRecord['source']
  expiresAt: number
}

export const DASHBOARD_MUTATION_ROLES: readonly DashboardOperatorRole[] = [
  'owner',
  'operator',
]

function normalizeOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === '*') {
    return undefined
  }

  try {
    return new URL(trimmed).origin
  } catch {
    return undefined
  }
}

function readCsvValues(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function buildAllowedCorsOrigins(env: Env): Set<string> {
  const configuredOrigins = [
    ...readCsvValues(env.PALMOS_ALLOWED_ORIGINS),
    ...readCsvValues(env.DASHBOARD_ALLOWED_ORIGINS),
    env.PALMOS_FRONTEND_ORIGIN,
    env.FRONTEND_ORIGIN,
  ]
  const localOrigins = [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:4173',
    'http://localhost:4173',
    'http://127.0.0.1:4030',
    'http://localhost:4030',
  ]
  const origins = [...configuredOrigins, ...localOrigins]
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin))

  return new Set(origins)
}

export function readCookie(req: express.Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie
  const rawCookie = Array.isArray(cookieHeader)
    ? cookieHeader.join('; ')
    : cookieHeader
  if (!rawCookie) return undefined

  for (const segment of rawCookie.split(';')) {
    const [key, ...valueParts] = segment.trim().split('=')
    if (key === name) {
      return decodeURIComponent(valueParts.join('='))
    }
  }

  return undefined
}

export function signDashboardAccessExpiry(
  expiresAt: number,
  secret: string,
): string {
  const payload = String(expiresAt)
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url')

  return `${payload}.${signature}`
}

export function verifyDashboardAccessExpiry(
  cookieValue: string | undefined,
  secret: string | undefined,
): number {
  if (!cookieValue || !secret) {
    return 0
  }

  const [payload, signature] = cookieValue.split('.')
  const expiresAt = Number(payload)
  if (!payload || !signature || !Number.isFinite(expiresAt)) {
    return 0
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url')
  const supplied = Buffer.from(signature)
  const expected = Buffer.from(expectedSignature)

  if (supplied.length !== expected.length) {
    return 0
  }

  return timingSafeEqual(supplied, expected) ? expiresAt : 0
}

// --- SIWS operator session cookie (palmos_operator_session) ---------------
// The signed-in operator's identity is carried in an HMAC-signed cookie payload
// (operatorId | workspaceId | role | expiresAt), signed with PALMOS_SESSION_SECRET.
// In non-public local dev a fixed dev secret is used so the bypass keeps working
// without configuration; in public mode the secret is required.
export type OperatorSessionPayload = {
  operatorId: string
  workspaceId: string
  role: DashboardOperatorRole
  expiresAt: number
}

export function readOperatorSessionSecret(env: Env): string | undefined {
  const configured = env.PALMOS_SESSION_SECRET?.trim()
  if (configured) {
    return configured
  }
  return isPublicAccessMode(env) ? undefined : DEV_SESSION_SECRET
}

export function signOperatorSession(
  payload: OperatorSessionPayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${signature}`
}

export function verifyOperatorSession(
  cookieValue: string | undefined,
  secret: string | undefined,
  now: number,
): OperatorSessionPayload | undefined {
  if (!cookieValue || !secret) {
    return undefined
  }

  const separatorIndex = cookieValue.lastIndexOf('.')
  if (separatorIndex <= 0) {
    return undefined
  }

  const body = cookieValue.slice(0, separatorIndex)
  const signature = cookieValue.slice(separatorIndex + 1)
  const expectedSignature = createHmac('sha256', secret)
    .update(body)
    .digest('base64url')
  const supplied = Buffer.from(signature)
  const expected = Buffer.from(expectedSignature)
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }

  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const candidate = parsed as Record<string, unknown>
  if (
    typeof candidate.operatorId !== 'string' ||
    typeof candidate.workspaceId !== 'string' ||
    typeof candidate.expiresAt !== 'number' ||
    !isDashboardOperatorRole(
      typeof candidate.role === 'string' ? candidate.role : undefined,
    )
  ) {
    return undefined
  }
  if (candidate.expiresAt <= now) {
    return undefined
  }

  return {
    operatorId: candidate.operatorId,
    workspaceId: candidate.workspaceId,
    role: candidate.role as DashboardOperatorRole,
    expiresAt: candidate.expiresAt,
  }
}

export function readDashboardWorkspaceId(env: Env): string {
  return (
    env.PALMOS_WORKSPACE_ID?.trim() ||
    env.PALMOS_ORG_ID?.trim() ||
    'palmos_workspace_default'
  )
}

function isDashboardOperatorRole(value: string | undefined): value is DashboardOperatorRole {
  return value === 'owner' || value === 'operator' || value === 'viewer'
}

function readEnvOperatorRole(env: Env): DashboardOperatorRole {
  const configuredRole = env.PALMOS_OPERATOR_ROLE?.trim()
  return isDashboardOperatorRole(configuredRole) ? configuredRole : 'operator'
}

function readEnvOperatorId(env: Env): string {
  return env.PALMOS_OPERATOR_ID?.trim() || 'operator_primary'
}

export function buildDashboardAccessCapabilities(input: {
  identity?: DashboardAccessIdentity
  env: Env
}): {
  canMutateDashboard: boolean
  canManageOperators: boolean
} {
  const role = input.identity?.role
  return {
    canMutateDashboard: role === 'owner' || role === 'operator',
    canManageOperators: role === 'owner',
  }
}

function readLocalDevelopmentIdentity(env: Env): DashboardAccessIdentity {
  const operatorId = readEnvOperatorId(env)
  return {
    operatorId,
    workspaceId: readDashboardWorkspaceId(env),
    actorId: `operator:${operatorId}`,
    role: readEnvOperatorRole(env),
    source: 'env',
    expiresAt: Number.MAX_SAFE_INTEGER,
  }
}

// Reads the SIWS operator session cookie (palmos_operator_session) and returns
// the signed-in operator's identity, or undefined when no valid session is
// present. Callers fall back to the local-dev identity in non-public mode.
export function readDashboardAccessIdentity(input: {
  req: express.Request
  env: Env
  now?: number
}): DashboardAccessIdentity | undefined {
  const now = input.now ?? Date.now()
  const payload = verifyOperatorSession(
    readCookie(input.req, OPERATOR_SESSION_COOKIE),
    readOperatorSessionSecret(input.env),
    now,
  )
  if (!payload) {
    return undefined
  }

  return {
    operatorId: payload.operatorId,
    workspaceId: payload.workspaceId,
    actorId: `operator:${payload.operatorId}`,
    role: payload.role,
    source: 'siws',
    expiresAt: payload.expiresAt,
  }
}

export function readDashboardSessionIdentity(input: {
  req: express.Request
  env: Env
  now?: number
}): DashboardAccessIdentity | undefined {
  return (
    readDashboardAccessIdentity(input) ??
    (!isPublicAccessMode(input.env)
      ? readLocalDevelopmentIdentity(input.env)
      : undefined)
  )
}

export function hasDashboardAccess(input: {
  req: express.Request
  env: Env
  now?: number
}): boolean {
  return Boolean(readDashboardAccessIdentity(input))
}

export function requireDashboardRole(input: {
  req: express.Request
  res: express.Response
  context: DashboardRouteContext
  roles?: readonly DashboardOperatorRole[]
  operation?: string
}): DashboardAccessIdentity | undefined {
  const roles = input.roles ?? DASHBOARD_MUTATION_ROLES
  const identity =
    readDashboardAccessIdentity({
      req: input.req,
      env: input.context.env,
    }) ??
    (!isPublicAccessMode(input.context.env)
      ? readLocalDevelopmentIdentity(input.context.env)
      : undefined)

  if (!identity) {
    sendDashboardApiError(input.res, 401, {
      code: 'dashboard_access_required',
      message: 'Dashboard access is required.',
    })
    return undefined
  }

  if (!roles.includes(identity.role)) {
    sendDashboardApiError(input.res, 403, {
      code: 'dashboard_role_required',
      message: 'Dashboard role does not allow this operation.',
      details: {
        requiredRoles: roles,
        role: identity.role,
        operation: input.operation,
      },
    })
    return undefined
  }

  return identity
}

// Cookie builder retained for reuse by the SIWS session cookie in P1.
export function buildDashboardAccessCookie(input: {
  name: string
  token: string
  maxAge: number
  crossSiteCookie: boolean
}): string {
  const secureCookie = input.crossSiteCookie ? '; Secure' : ''
  const sameSiteCookie = input.crossSiteCookie
    ? '; SameSite=None'
    : '; SameSite=Lax'

  return `${input.name}=${encodeURIComponent(input.token)}; Max-Age=${input.maxAge}; Path=/; HttpOnly${sameSiteCookie}${secureCookie}`
}

export function installCors(app: express.Express, env: Env): void {
  const allowedCorsOrigins = buildAllowedCorsOrigins(env)
  app.use((req, res, next) => {
    const requestOrigin = Array.isArray(req.headers.origin)
      ? req.headers.origin[0]
      : req.headers.origin
    const normalizedOrigin = normalizeOrigin(requestOrigin)

    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-PalmOS-Agent-Key, Idempotency-Key, X-Idempotency-Key',
    )

    if (normalizedOrigin && allowedCorsOrigins.has(normalizedOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', normalizedOrigin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    }

    if (req.method === 'OPTIONS') {
      res
        .status(normalizedOrigin && !allowedCorsOrigins.has(normalizedOrigin) ? 403 : 204)
        .end()
      return
    }
    next()
  })
}

// P0: the shared-passcode login routes (operator-login / judge-access) have been
// removed. The global guard stays (per-route requireDashboardRole still applies);
// P1 replaces it with a SIWS session guard that allows /api/auth/* and otherwise
// requires a valid operator session (docs/operator-auth-plan.md §4).
export function installDashboardAccessGuard(
  app: express.Express,
  env: Env,
): void {
  app.use('/api/dashboard', (req, res, next) => {
    if (!isPublicAccessMode(env)) {
      next()
      return
    }

    if (req.path === '/health') {
      next()
      return
    }

    if (hasDashboardAccess({ req, env })) {
      next()
      return
    }

    sendDashboardApiError(res, 401, {
      code: 'dashboard_access_required',
      message: 'Dashboard access is required.',
    })
  })
}
