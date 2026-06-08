import { randomUUID } from 'crypto'
import type express from 'express'
import type { DashboardOperationalMetricsStore } from './operationalMetrics.js'
import type { Env } from './shared.js'

const REQUEST_ID_HEADER = 'x-request-id'
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/

export type DashboardRequestLogRecord = {
  level: 'info' | 'warn'
  event: 'dashboard.request'
  requestId: string
  method: string
  path: string
  statusCode: number
  durationMs: number
  contentLength?: number
  userAgent?: string
}

function readFirstHeader(
  value: string | number | string[] | undefined,
): string | undefined {
  if (typeof value === 'number') {
    return String(value)
  }

  return Array.isArray(value) ? value[0] : value
}

function isRequestLoggingEnabled(env: Env): boolean {
  const configured = env.PALMOS_REQUEST_LOGS?.trim().toLowerCase()
  return configured !== '0' && configured !== 'false'
}

export function createDashboardRequestId(input?: string): string {
  const candidate = input?.trim()
  if (candidate && REQUEST_ID_PATTERN.test(candidate)) {
    return candidate
  }

  return `req_${randomUUID()}`
}

export function readDashboardRequestId(
  res: express.Response,
): string | undefined {
  const value = res.locals?.palmosRequestId
  return typeof value === 'string' ? value : undefined
}

export function buildDashboardRequestLogRecord(input: {
  requestId: string
  method: string
  path: string
  statusCode: number
  durationMs: number
  contentLength?: string | number | string[]
  userAgent?: string | string[]
}): DashboardRequestLogRecord {
  const contentLength = Number(readFirstHeader(input.contentLength))
  const statusCode = input.statusCode

  return {
    level: statusCode >= 500 ? 'warn' : 'info',
    event: 'dashboard.request',
    requestId: input.requestId,
    method: input.method,
    path: input.path,
    statusCode,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
    userAgent: readFirstHeader(input.userAgent),
  }
}

export function installDashboardRequestTelemetry(
  app: express.Express,
  env: Env,
  operationalMetrics?: DashboardOperationalMetricsStore,
): void {
  const loggingEnabled = isRequestLoggingEnabled(env)

  app.use((req, res, next) => {
    const startedAt = performance.now()
    const requestId = createDashboardRequestId(
      readFirstHeader(req.headers[REQUEST_ID_HEADER]),
    )

    res.locals.palmosRequestId = requestId
    res.setHeader('X-Request-Id', requestId)

    if (loggingEnabled) {
      res.on('finish', () => {
        operationalMetrics?.recordHttpStatus(res.statusCode)
        console.log(
          JSON.stringify(
            buildDashboardRequestLogRecord({
              requestId,
              method: req.method,
              path: req.path,
              statusCode: res.statusCode,
              durationMs: performance.now() - startedAt,
              contentLength: res.getHeader('content-length'),
              userAgent: req.headers['user-agent'],
            }),
          ),
        )
      })
    } else {
      res.on('finish', () => {
        operationalMetrics?.recordHttpStatus(res.statusCode)
      })
    }

    next()
  })
}
