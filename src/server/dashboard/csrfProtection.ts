import type express from 'express'
import { buildAllowedCorsOrigins } from './access.js'
import { sendDashboardApiError } from './apiErrors.js'
import { isPublicAccessMode } from './config.js'
import type { DashboardOperationalMetricsStore } from './operationalMetrics.js'
import type { Env } from './shared.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

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

function readFirstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function readRequestOrigin(req: express.Request): string | undefined {
  const forwardedProto = readFirstHeader(req.headers['x-forwarded-proto'])
    ?.split(',')[0]
    ?.trim()
  const forwardedHost = readFirstHeader(req.headers['x-forwarded-host'])
    ?.split(',')[0]
    ?.trim()
  const proto = forwardedProto || req.protocol || 'http'
  const host = forwardedHost || req.headers.host

  return normalizeOrigin(host ? `${proto}://${host}` : undefined)
}

function readRefererOrigin(req: express.Request): string | undefined {
  const referer = readFirstHeader(req.headers.referer)
  return normalizeOrigin(referer)
}

function isAllowedDashboardMutationOrigin(
  req: express.Request,
  env: Env,
): boolean {
  const secFetchSite = readFirstHeader(req.headers['sec-fetch-site'])
  if (secFetchSite === 'cross-site') {
    return false
  }

  const allowedOrigins = buildAllowedCorsOrigins(env)
  const requestOrigin = readRequestOrigin(req)
  if (requestOrigin) {
    allowedOrigins.add(requestOrigin)
  }

  const suppliedOrigin =
    normalizeOrigin(readFirstHeader(req.headers.origin)) ?? readRefererOrigin(req)
  return Boolean(suppliedOrigin && allowedOrigins.has(suppliedOrigin))
}

export function installDashboardCsrfProtection(
  app: express.Express,
  env: Env,
  operationalMetrics?: DashboardOperationalMetricsStore,
): void {
  app.use('/api/dashboard', (req, res, next) => {
    if (!isPublicAccessMode(env) || SAFE_METHODS.has(req.method)) {
      next()
      return
    }

    if (isAllowedDashboardMutationOrigin(req, env)) {
      next()
      return
    }

    operationalMetrics?.increment('dashboard.csrf_failures')
    sendDashboardApiError(res, 403, {
      code: 'csrf_check_failed',
      message: 'Dashboard mutation origin could not be verified.',
      details: {
        method: req.method,
        path: req.path,
      },
    })
  })
}
