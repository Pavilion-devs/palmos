import { createHash } from 'crypto'
import express from 'express'
import { sendDashboardApiError } from './apiErrors.js'
import type { Env } from './shared.js'
import { readAuthToken } from './shared.js'

export type DashboardRateLimitProfile = {
  name: string
  max: number
  windowMs: number
}

export type DashboardRateLimitDecision = {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
  retryAfterMs: number
}

export type DashboardRateLimitProfileKey =
  | 'auth'
  | 'waitlist'
  | 'onboarding'
  | 'sdkPay'
  | 'credentials'
  | 'serviceRegistration'

type RateLimitBucket = {
  count: number
  resetAt: number
}

const DEFAULT_JSON_BODY_LIMIT = '256kb'

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value?.trim())
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback
}

export function readDashboardJsonBodyLimit(env: Env): string {
  return (
    env.PALMOS_JSON_BODY_LIMIT?.trim() ||
    env.DASHBOARD_JSON_BODY_LIMIT?.trim() ||
    DEFAULT_JSON_BODY_LIMIT
  )
}

export function readDashboardRateLimitProfiles(
  env: Env,
): Record<DashboardRateLimitProfileKey, DashboardRateLimitProfile> {
  return {
    auth: {
      name: 'auth',
      max: readPositiveInteger(env.PALMOS_RATE_LIMIT_AUTH_MAX, 10),
      windowMs: readPositiveInteger(
        env.PALMOS_RATE_LIMIT_AUTH_WINDOW_MS,
        60_000,
      ),
    },
    waitlist: {
      name: 'waitlist',
      max: readPositiveInteger(env.PALMOS_RATE_LIMIT_WAITLIST_MAX, 20),
      windowMs: readPositiveInteger(
        env.PALMOS_RATE_LIMIT_WAITLIST_WINDOW_MS,
        60 * 60_000,
      ),
    },
    onboarding: {
      name: 'onboarding',
      max: readPositiveInteger(env.PALMOS_RATE_LIMIT_ONBOARDING_MAX, 60),
      windowMs: readPositiveInteger(
        env.PALMOS_RATE_LIMIT_ONBOARDING_WINDOW_MS,
        60_000,
      ),
    },
    sdkPay: {
      name: 'sdk_pay',
      max: readPositiveInteger(env.PALMOS_RATE_LIMIT_SDK_PAY_MAX, 120),
      windowMs: readPositiveInteger(
        env.PALMOS_RATE_LIMIT_SDK_PAY_WINDOW_MS,
        60_000,
      ),
    },
    credentials: {
      name: 'credentials',
      max: readPositiveInteger(env.PALMOS_RATE_LIMIT_CREDENTIALS_MAX, 30),
      windowMs: readPositiveInteger(
        env.PALMOS_RATE_LIMIT_CREDENTIALS_WINDOW_MS,
        60_000,
      ),
    },
    serviceRegistration: {
      name: 'service_registration',
      max: readPositiveInteger(env.PALMOS_RATE_LIMIT_SERVICE_REGISTRATION_MAX, 20),
      windowMs: readPositiveInteger(
        env.PALMOS_RATE_LIMIT_SERVICE_REGISTRATION_WINDOW_MS,
        60_000,
      ),
    },
  }
}

export function createDashboardRateLimitStore() {
  const buckets = new Map<string, RateLimitBucket>()

  return {
    check(input: {
      key: string
      profile: DashboardRateLimitProfile
      now?: number
    }): DashboardRateLimitDecision {
      const now = input.now ?? Date.now()
      const bucketKey = `${input.profile.name}:${input.key}`
      const existing = buckets.get(bucketKey)
      const bucket =
        existing && existing.resetAt > now
          ? existing
          : {
              count: 0,
              resetAt: now + input.profile.windowMs,
            }

      bucket.count += 1
      buckets.set(bucketKey, bucket)

      const remaining = Math.max(0, input.profile.max - bucket.count)
      const retryAfterMs = Math.max(0, bucket.resetAt - now)

      return {
        allowed: bucket.count <= input.profile.max,
        limit: input.profile.max,
        remaining,
        resetAt: bucket.resetAt,
        retryAfterMs,
      }
    },
    clear(): void {
      buckets.clear()
    },
  }
}

function readRequestIp(req: express.Request): string {
  const forwardedFor = req.headers['x-forwarded-for']
  const firstForwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]?.split(',')[0]?.trim()
    : forwardedFor?.split(',')[0]?.trim()

  return (
    firstForwardedIp ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown_client'
  )
}

function readRateLimitKey(req: express.Request, profileName: string): string {
  const authToken = readAuthToken(req)
  const authTokenHash = authToken
    ? createHash('sha256').update(authToken).digest('base64url').slice(0, 16)
    : undefined
  return [
    profileName,
    readRequestIp(req),
    authTokenHash ? `token:${authTokenHash}` : 'anonymous',
  ].join(':')
}

function matchesDashboardRateLimitProfile(
  req: express.Request,
): DashboardRateLimitProfileKey | undefined {
  // SIWS sign-in verify endpoint (added in P1 — docs/operator-auth-plan.md §4).
  // Rate-limited as 'auth' to throttle signature-guessing against the nonce.
  if (req.method === 'POST' && req.path === '/api/auth/verify') {
    return 'auth'
  }

  if (req.method === 'POST' && req.path === '/api/waitlist') {
    return 'waitlist'
  }

  if (
    req.method === 'POST' &&
    (req.path === '/api/dashboard/onboarding/turn' ||
      req.path === '/api/dashboard/agents')
  ) {
    return 'onboarding'
  }

  if (req.method === 'POST' && req.path === '/api/sdk/v1/pay') {
    return 'sdkPay'
  }

  if (
    (req.method === 'POST' &&
      /^\/api\/dashboard\/agents\/[^/]+\/credentials$/.test(req.path)) ||
    (req.method === 'PATCH' &&
      /^\/api\/dashboard\/agent-credentials\/[^/]+$/.test(req.path)) ||
    (req.method === 'POST' &&
      /^\/api\/dashboard\/agent-credentials\/[^/]+\/(revoke|rotate)$/.test(
        req.path,
      ))
  ) {
    return 'credentials'
  }

  if (req.method === 'POST' && req.path === '/api/dashboard/services') {
    return 'serviceRegistration'
  }

  return undefined
}

export function installDashboardAbuseProtection(
  app: express.Express,
  env: Env,
): void {
  const profiles = readDashboardRateLimitProfiles(env)
  const store = createDashboardRateLimitStore()

  app.use(
    express.json({
      limit: readDashboardJsonBodyLimit(env),
    }),
  )

  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!error) {
        next()
        return
      }

      if (
        typeof error === 'object' &&
        error != null &&
        'type' in error &&
        error.type === 'entity.too.large'
      ) {
        sendDashboardApiError(res, 413, {
          code: 'request_body_too_large',
          message: 'Request body is too large.',
          details: {
            limit: readDashboardJsonBodyLimit(env),
          },
        })
        return
      }

      if (error instanceof SyntaxError) {
        sendDashboardApiError(res, 400, {
          code: 'invalid_json_body',
          message: 'Request body is not valid JSON.',
        })
        return
      }

      next(error)
    },
  )

  app.use((req, res, next) => {
    const profileKey = matchesDashboardRateLimitProfile(req)
    if (!profileKey) {
      next()
      return
    }

    const profile = profiles[profileKey]
    const decision = store.check({
      profile,
      key: readRateLimitKey(req, profile.name),
    })

    res.setHeader('X-RateLimit-Limit', String(decision.limit))
    res.setHeader('X-RateLimit-Remaining', String(decision.remaining))
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(decision.resetAt / 1000)))

    if (decision.allowed) {
      next()
      return
    }

    res.setHeader('Retry-After', String(Math.ceil(decision.retryAfterMs / 1000)))
    sendDashboardApiError(res, 429, {
      code: 'rate_limit_exceeded',
      message: 'Too many requests. Try again after the retry window.',
      details: {
        profile: profile.name,
        limit: decision.limit,
        windowMs: profile.windowMs,
        retryAfterMs: decision.retryAfterMs,
      },
    })
  })
}
