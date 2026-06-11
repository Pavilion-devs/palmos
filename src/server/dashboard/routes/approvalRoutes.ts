import type express from 'express'
import { requireDashboardRole } from '../access.js'
import {
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import type { DashboardRouteContext } from '../context.js'
import { buildDashboardApprovals } from '../dashboardApprovals.js'
import { readMaybeString } from '../shared.js'

function readQueryValue(value: unknown): string | undefined {
  return readMaybeString(Array.isArray(value) ? value[0] : value)
}

export function registerApprovalReadRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.get('/api/dashboard/approvals', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner', 'operator'],
      operation: 'approval.queue.read',
    })
    if (!identity) {
      return
    }

    try {
      const approvals = await buildDashboardApprovals({
        workspace: context.workspace,
        query: {
          agentId: readQueryValue(req.query.agentId),
          walletId: readQueryValue(req.query.walletId),
        },
      })

      res.json({
        ok: true,
        projectionMode: approvals.projectionMode,
        summary: approvals.summary,
        approvals: approvals.approvals,
      })
    } catch (error) {
      sendDashboardInternalError(
        res,
        error instanceof Error
          ? error.message
          : 'Unable to read dashboard approvals.',
      )
    }
  })
}
