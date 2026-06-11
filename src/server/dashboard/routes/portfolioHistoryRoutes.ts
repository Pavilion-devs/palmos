import type express from 'express'
import { requireDashboardRole } from '../access.js'
import {
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import type { DashboardRouteContext } from '../context.js'
import { readMaybeString } from '../shared.js'

const DEFAULT_PORTFOLIO_HISTORY_LIMIT = 20

function readLimit(value: unknown): number {
  const raw = readMaybeString(Array.isArray(value) ? value[0] : value)
  const parsed = raw ? Number(raw) : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PORTFOLIO_HISTORY_LIMIT
  }
  return Math.min(Math.trunc(parsed), 200)
}

export function registerPortfolioHistoryRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.get(
    '/api/dashboard/agents/:agentId/portfolio-history',
    async (req, res) => {
      const identity = requireDashboardRole({
        req,
        res,
        context,
        roles: ['owner', 'operator'],
        operation: 'agent.portfolio_history.read',
      })
      if (!identity) {
        return
      }

      const agentId = readMaybeString(req.params.agentId)
      if (!agentId) {
        sendDashboardApiError(res, 400, {
          code: 'invalid_request',
          message: 'Missing agent id.',
        })
        return
      }

      if (!context.portfolioSnapshotRegistry) {
        sendDashboardApiError(res, 409, {
          code: 'conflict',
          message:
            'PortfolioSnapshot registry is not available in this workspace.',
        })
        return
      }

      try {
        const agent = await context.workspace.agentRegistry.get(agentId)
        if (!agent) {
          sendDashboardApiError(res, 404, {
            code: 'not_found',
            message: `Agent ${agentId} was not found.`,
            details: {
              agentId,
            },
          })
          return
        }

        const limit = readLimit(req.query.limit)
        const snapshots = await context.portfolioSnapshotRegistry.listByAgent(
          agentId,
          { limit },
        )

        res.json({
          ok: true,
          agentId,
          limit,
          snapshots,
        })
      } catch (error) {
        sendDashboardInternalError(
          res,
          error instanceof Error
            ? error.message
            : 'Unable to read agent portfolio history.',
        )
      }
    },
  )

  // Cross-agent assets-under-control over time. Aggregates the per-agent portfolio
  // snapshots by capture timestamp (the snapshot cron captures agents in batches,
  // so timestamps align) and sums totalValueUsd into a single workspace series.
  app.get('/api/dashboard/assets-under-control/history', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner', 'operator'],
      operation: 'assets_under_control.history.read',
    })
    if (!identity) {
      return
    }

    if (!context.portfolioSnapshotRegistry) {
      res.json({ ok: true, series: [] })
      return
    }

    try {
      const limit = readLimit(req.query.limit)
      const agents = await context.workspace.agentRegistry.list()
      const totalByCapturedAt = new Map<string, number>()
      for (const agent of agents) {
        const snapshots = await context.portfolioSnapshotRegistry.listByAgent(
          agent.agentId,
          { limit },
        )
        for (const snapshot of snapshots) {
          const value = Number.isFinite(snapshot.totalValueUsd)
            ? snapshot.totalValueUsd
            : 0
          totalByCapturedAt.set(
            snapshot.capturedAt,
            (totalByCapturedAt.get(snapshot.capturedAt) ?? 0) + value,
          )
        }
      }

      const series = [...totalByCapturedAt.entries()]
        .map(([at, valueUsd]) => ({ at, valueUsd }))
        .sort((left, right) => left.at.localeCompare(right.at))

      res.json({ ok: true, series })
    } catch (error) {
      sendDashboardInternalError(
        res,
        error instanceof Error
          ? error.message
          : 'Unable to build assets-under-control history.',
      )
    }
  })
}
