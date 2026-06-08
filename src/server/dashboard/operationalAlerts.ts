import type {
  DashboardOperationalMetricsReport,
} from './operationalMetrics.js'
import type {
  DashboardSystemHealthReport,
} from './systemHealth.js'
import type { Env } from './shared.js'

export type DashboardOperationalAlertSeverity = 'warning' | 'critical'

export type DashboardOperationalAlert = {
  alertId: string
  severity: DashboardOperationalAlertSeverity
  generatedAt: string
  summary: string
  details?: Record<string, unknown>
}

export type DashboardOperationalAlertDispatcher = {
  dispatch(alerts: DashboardOperationalAlert[]): Promise<void>
}

type AlertDeliveryTarget = {
  logs: boolean
  webhookUrl?: string
}

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true') {
    return true
  }
  if (normalized === '0' || normalized === 'false') {
    return false
  }
  return fallback
}

function readPositiveNumber(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value?.trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function readWebhookUrl(env: Env): string | undefined {
  const value = env.PALMOS_ALERT_WEBHOOK_URL?.trim()
  if (!value) {
    return undefined
  }

  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? value
      : undefined
  } catch {
    return undefined
  }
}

function readAlertTargets(env: Env): AlertDeliveryTarget {
  return {
    logs: readBooleanEnv(env.PALMOS_ALERT_LOGS, true),
    webhookUrl: readWebhookUrl(env),
  }
}

function createAlert(input: {
  alertId: string
  severity: DashboardOperationalAlertSeverity
  generatedAt: string
  summary: string
  details?: Record<string, unknown>
}): DashboardOperationalAlert {
  return {
    alertId: input.alertId,
    severity: input.severity,
    generatedAt: input.generatedAt,
    summary: input.summary,
    details: input.details,
  }
}

export function evaluateDashboardOperationalAlerts(input: {
  env?: Env
  metrics: DashboardOperationalMetricsReport
  health?: DashboardSystemHealthReport
}): DashboardOperationalAlert[] {
  const env = input.env ?? {}
  const generatedAt = input.metrics.generatedAt
  const counters = input.metrics.processCounters
  const recent5xxThreshold = readPositiveNumber(
    env.PALMOS_ALERT_RECENT_5XX_THRESHOLD,
    1,
  )
  const csrfFailureThreshold = readPositiveNumber(
    env.PALMOS_ALERT_CSRF_FAILURE_THRESHOLD,
    10,
  )
  const alerts: DashboardOperationalAlert[] = []

  if (input.metrics.http.recent5xx >= recent5xxThreshold) {
    alerts.push(
      createAlert({
        alertId: 'dashboard.http_5xx_recent',
        severity: 'critical',
        generatedAt,
        summary: 'Dashboard API returned recent 5xx responses.',
        details: {
          recent5xx: input.metrics.http.recent5xx,
          recentRequests: input.metrics.http.recentRequests,
          windowMs: input.metrics.http.windowMs,
          threshold: recent5xxThreshold,
        },
      }),
    )
  }

  if (counters['dashboard.db_failures'] > 0) {
    alerts.push(
      createAlert({
        alertId: 'dashboard.db_failures',
        severity: 'critical',
        generatedAt,
        summary: 'Dashboard observed Postgres health failures.',
        details: {
          failures: counters['dashboard.db_failures'],
        },
      }),
    )
  }

  if (counters['dashboard.backup_failures'] > 0) {
    alerts.push(
      createAlert({
        alertId: 'dashboard.backup_failures',
        severity: 'critical',
        generatedAt,
        summary: 'Dashboard observed Postgres backup health failures.',
        details: {
          failures: counters['dashboard.backup_failures'],
        },
      }),
    )
  }

  if (counters['dashboard.csrf_failures'] >= csrfFailureThreshold) {
    alerts.push(
      createAlert({
        alertId: 'dashboard.csrf_failures',
        severity: 'warning',
        generatedAt,
        summary: 'Dashboard observed repeated CSRF origin check failures.',
        details: {
          failures: counters['dashboard.csrf_failures'],
          threshold: csrfFailureThreshold,
        },
      }),
    )
  }

  const approvalFailures = Math.max(
    counters['approval.execution_failures'],
    input.metrics.approvals.executionFailures,
  )
  if (approvalFailures > 0) {
    alerts.push(
      createAlert({
        alertId: 'approval.execution_failures',
        severity: 'critical',
        generatedAt,
        summary: 'Approval resolution has produced failed executions.',
        details: {
          failures: approvalFailures,
        },
      }),
    )
  }

  for (const check of input.health?.checks ?? []) {
    if (check.status !== 'failed') {
      continue
    }
    alerts.push(
      createAlert({
        alertId: `health.${check.checkId}`,
        severity: 'critical',
        generatedAt: input.health?.generatedAt ?? generatedAt,
        summary: check.summary,
        details: {
          checkId: check.checkId,
          ...check.details,
        },
      }),
    )
  }

  return alerts
}

async function postWebhook(input: {
  fetchImpl: typeof fetch
  url: string
  timeoutMs: number
  alerts: DashboardOperationalAlert[]
}): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    const response = await input.fetchImpl(input.url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ok: false,
        event: 'dashboard.alerts',
        alerts: input.alerts,
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`Alert webhook returned ${response.status}.`)
    }
  } finally {
    clearTimeout(timer)
  }
}

export function createDashboardOperationalAlertDispatcher(input: {
  env: Env
  fetchImpl?: typeof fetch
  nowMs?: () => number
}): DashboardOperationalAlertDispatcher {
  const env = input.env
  const enabled = readBooleanEnv(env.PALMOS_ALERTS_ENABLED, true)
  const targets = readAlertTargets(env)
  const minIntervalMs = readPositiveNumber(
    env.PALMOS_ALERT_MIN_INTERVAL_MS,
    15 * 60 * 1000,
  )
  const webhookTimeoutMs = readPositiveNumber(
    env.PALMOS_ALERT_WEBHOOK_TIMEOUT_MS,
    5_000,
  )
  const fetchImpl = input.fetchImpl ?? fetch
  const nowMs = input.nowMs ?? (() => Date.now())
  const lastSentAtByAlertId = new Map<string, number>()

  return {
    async dispatch(alerts) {
      if (!enabled || alerts.length === 0) {
        return
      }

      const at = nowMs()
      const deliverable = alerts.filter((alert) => {
        const lastSentAt = lastSentAtByAlertId.get(alert.alertId)
        return lastSentAt == null || at - lastSentAt >= minIntervalMs
      })
      if (deliverable.length === 0) {
        return
      }

      for (const alert of deliverable) {
        lastSentAtByAlertId.set(alert.alertId, at)
      }

      if (targets.logs) {
        for (const alert of deliverable) {
          console.warn(
            JSON.stringify({
              level: alert.severity === 'critical' ? 'error' : 'warn',
              event: 'dashboard.alert',
              alert,
            }),
          )
        }
      }

      if (targets.webhookUrl) {
        try {
          await postWebhook({
            fetchImpl,
            url: targets.webhookUrl,
            timeoutMs: webhookTimeoutMs,
            alerts: deliverable,
          })
        } catch (error) {
          console.warn(
            JSON.stringify({
              level: 'warn',
              event: 'dashboard.alert_delivery_failed',
              message:
                error instanceof Error
                  ? error.message
                  : 'Alert webhook delivery failed.',
            }),
          )
        }
      }
    },
  }
}
