import { createHmac, timingSafeEqual } from 'crypto'
import type express from 'express'
import type {
  DashboardOperatorRecord,
  DashboardOperatorRole,
} from '../../store/DashboardOperatorRegistry.js'
import { isPublicAccessMode, shouldUseCrossSiteJudgeCookie } from './config.js'
import type { DashboardRouteContext } from './context.js'
import { sendDashboardApiError } from './apiErrors.js'
import type { Env } from './shared.js'
import { readMaybeString } from './shared.js'

const JUDGE_ACCESS_COOKIE = 'palmos_judge_access'
const OPERATOR_ACCESS_COOKIE = 'palmos_operator_access'
const DASHBOARD_SESSION_TTL_MS = 1000 * 60 * 60 * 8

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

function readJudgeAccessExpiry(req: express.Request, env: Env): number {
  const sessionValue = readCookie(req, JUDGE_ACCESS_COOKIE)
  return verifyDashboardAccessExpiry(sessionValue, env.PALMOS_JUDGE_ACCESS_CODE?.trim())
}

function readOperatorAccessSecret(env: Env): string | undefined {
  return (
    env.PALMOS_OPERATOR_SESSION_SECRET?.trim() ||
    env.PALMOS_OPERATOR_PASSWORD?.trim() ||
    env.PALMOS_OPERATOR_ACCESS_CODE?.trim() ||
    undefined
  )
}

function readOperatorPassword(env: Env): string | undefined {
  return (
    env.PALMOS_OPERATOR_PASSWORD?.trim() ||
    env.PALMOS_OPERATOR_ACCESS_CODE?.trim() ||
    undefined
  )
}

function readOperatorAccessExpiry(req: express.Request, env: Env): number {
  const sessionValue = readCookie(req, OPERATOR_ACCESS_COOKIE)
  return verifyDashboardAccessExpiry(sessionValue, readOperatorAccessSecret(env))
}

export function readDashboardWorkspaceId(env: Env): string {
  return (
    env.PALMOS_WORKSPACE_ID?.trim() ||
    env.PALMOS_ORG_ID?.trim() ||
    'palmos_workspace_default'
  )
}

function isDashboardOperatorRole(value: string | undefined): value is DashboardOperatorRole {
  return (
    value === 'owner' ||
    value === 'operator' ||
    value === 'viewer' ||
    value === 'judge'
  )
}

function readEnvOperatorRole(env: Env): DashboardOperatorRole {
  const configuredRole = env.PALMOS_OPERATOR_ROLE?.trim()
  return isDashboardOperatorRole(configuredRole) && configuredRole !== 'judge'
    ? configuredRole
    : 'operator'
}

function readEnvOperatorId(env: Env): string {
  return env.PALMOS_OPERATOR_ID?.trim() || 'operator_primary'
}

function readEnvOperatorDisplayName(env: Env): string {
  return env.PALMOS_OPERATOR_DISPLAY_NAME?.trim() || 'Workspace Operator'
}

function isJudgeMutationAccessEnabled(env: Env): boolean {
  const configured = env.PALMOS_ALLOW_JUDGE_MUTATIONS?.trim().toLowerCase()
  return configured === '1' || configured === 'true'
}

export function buildDashboardAccessCapabilities(input: {
  identity?: DashboardAccessIdentity
  env: Env
}): {
  canMutateDashboard: boolean
  canManageOperators: boolean
  canUseJudgeMutationMode: boolean
} {
  const role = input.identity?.role
  const judgeMutationMode = isJudgeMutationAccessEnabled(input.env)
  const canMutateDashboard =
    role === 'owner' ||
    role === 'operator' ||
    (role === 'judge' && judgeMutationMode)

  return {
    canMutateDashboard,
    canManageOperators: role === 'owner',
    canUseJudgeMutationMode: role === 'judge' && judgeMutationMode,
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

function buildEnvOperatorRecord(
  env: Env,
  at: string,
  existing?: DashboardOperatorRecord,
): DashboardOperatorRecord {
  return {
    operatorId: readEnvOperatorId(env),
    workspaceId: readDashboardWorkspaceId(env),
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    displayName: readEnvOperatorDisplayName(env),
    role: readEnvOperatorRole(env),
    status: 'active',
    source: 'env',
    lastLoginAt: at,
  }
}

export function readDashboardAccessIdentity(input: {
  req: express.Request
  env: Env
  now?: number
}): DashboardAccessIdentity | undefined {
  const now = input.now ?? Date.now()
  const operatorExpiresAt = readOperatorAccessExpiry(input.req, input.env)
  if (operatorExpiresAt > now) {
    const operatorId = readEnvOperatorId(input.env)
    return {
      operatorId,
      workspaceId: readDashboardWorkspaceId(input.env),
      actorId: `operator:${operatorId}`,
      role: readEnvOperatorRole(input.env),
      source: 'env',
      expiresAt: operatorExpiresAt,
    }
  }

  const judgeExpiresAt = readJudgeAccessExpiry(input.req, input.env)
  if (judgeExpiresAt > now) {
    return {
      operatorId: 'judge_session',
      workspaceId: readDashboardWorkspaceId(input.env),
      actorId: 'judge:dashboard',
      role: 'judge',
      source: 'judge',
      expiresAt: judgeExpiresAt,
    }
  }

  return undefined
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

  const judgeAllowed =
    identity.role === 'judge' &&
    buildDashboardAccessCapabilities({
      identity,
      env: input.context.env,
    }).canUseJudgeMutationMode &&
    roles.includes('operator')

  if (!roles.includes(identity.role) && !judgeAllowed) {
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

function buildDashboardAccessCookie(input: {
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

export function registerJudgeAccessRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  const env = context.env

  app.post('/api/dashboard/operator-login', async (req, res) => {
    const configuredPassword = readOperatorPassword(env)
    const submittedPassword =
      readMaybeString(req.body?.password) ?? readMaybeString(req.body?.passcode)

    if (!configuredPassword || submittedPassword !== configuredPassword) {
      sendDashboardApiError(res, 401, {
        code: 'invalid_operator_login',
        message: 'Invalid operator login.',
      })
      return
    }

    const secret = readOperatorAccessSecret(env)
    if (!secret) {
      sendDashboardApiError(res, 500, {
        code: 'operator_session_secret_not_configured',
        message: 'Operator session secret is not configured.',
      })
      return
    }

    const at = new Date().toISOString()
    const operatorId = readEnvOperatorId(env)
    const existing =
      await context.workspace.dashboardOperatorRegistry.get(operatorId)
    if (existing?.status === 'disabled') {
      sendDashboardApiError(res, 403, {
        code: 'operator_disabled',
        message: 'Operator account is disabled.',
      })
      return
    }

    const operator = buildEnvOperatorRecord(env, at, existing)
    const saved = existing
      ? await context.workspace.dashboardOperatorRegistry.putIfUpdatedAt(
          operator,
          existing.updatedAt,
        )
      : (await context.workspace.dashboardOperatorRegistry.put(operator), true)
    if (!saved) {
      const current =
        await context.workspace.dashboardOperatorRegistry.get(operatorId)
      if (current?.status === 'disabled') {
        sendDashboardApiError(res, 403, {
          code: 'operator_disabled',
          message: 'Operator account is disabled.',
        })
        return
      }
      sendDashboardApiError(res, 409, {
        code: 'operator_conflict',
        message: 'Operator account changed while login was in progress.',
        details: {
          operatorId,
          currentUpdatedAt: current?.updatedAt,
          currentStatus: current?.status,
        },
      })
      return
    }

    const expiresAt = Date.now() + DASHBOARD_SESSION_TTL_MS
    const maxAge = Math.floor((expiresAt - Date.now()) / 1000)
    const crossSiteCookie = shouldUseCrossSiteJudgeCookie(env)
    const sessionToken = signDashboardAccessExpiry(expiresAt, secret)
    res.setHeader(
      'Set-Cookie',
      buildDashboardAccessCookie({
        name: OPERATOR_ACCESS_COOKIE,
        token: sessionToken,
        maxAge,
        crossSiteCookie,
      }),
    )
    res.json({
      ok: true,
      operator: {
        operatorId: operator.operatorId,
        workspaceId: operator.workspaceId,
        displayName: operator.displayName,
        role: operator.role,
      },
      role: operator.role,
      expiresAt,
    })
  })

  app.post('/api/dashboard/judge-access', async (req, res) => {
    const configuredCode = env.PALMOS_JUDGE_ACCESS_CODE?.trim()
    const submittedCode = readMaybeString(req.body?.passcode)

    if (!configuredCode || submittedCode !== configuredCode) {
      sendDashboardApiError(res, 401, {
        code: 'invalid_judge_code',
        message: 'Invalid judge access code.',
      })
      return
    }

    const expiresAt = Date.now() + DASHBOARD_SESSION_TTL_MS
    const maxAge = Math.floor((expiresAt - Date.now()) / 1000)
    const crossSiteCookie = shouldUseCrossSiteJudgeCookie(env)
    const sessionToken = signDashboardAccessExpiry(expiresAt, configuredCode)
    res.setHeader(
      'Set-Cookie',
      buildDashboardAccessCookie({
        name: JUDGE_ACCESS_COOKIE,
        token: sessionToken,
        maxAge,
        crossSiteCookie,
      }),
    )
    res.json({
      ok: true,
      role: 'judge',
      operator: {
        operatorId: 'judge_session',
        workspaceId: readDashboardWorkspaceId(env),
        displayName: 'Judge Session',
        role: 'judge',
      },
      expiresAt,
    })
  })
}

export function installDashboardAccessGuard(
  app: express.Express,
  env: Env,
): void {
  app.use('/api/dashboard', (req, res, next) => {
    if (!isPublicAccessMode(env)) {
      next()
      return
    }

    if (
      req.path === '/judge-access' ||
      req.path === '/operator-login' ||
      req.path === '/health'
    ) {
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
