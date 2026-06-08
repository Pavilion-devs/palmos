import type express from 'express'
import { buildDashboardAgentWalletCycle } from '../agentWalletCycle.js'
import { requireDashboardRole } from '../access.js'
import {
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import type { DashboardRouteContext } from '../context.js'
import { readMaybeString } from '../shared.js'

export function registerAgentWalletCycleRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.get('/api/dashboard/agents/:agentId/wallet-cycle', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner', 'operator', 'judge'],
      operation: 'agent.wallet_cycle.read',
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

    try {
      const walletCycle = await buildDashboardAgentWalletCycle({
        workspace: context.workspace,
        agentId,
      })

      if (!walletCycle) {
        sendDashboardApiError(res, 404, {
          code: 'not_found',
          message: `Agent ${agentId} was not found.`,
          details: {
            agentId,
          },
        })
        return
      }

      res.json({
        ok: true,
        walletCycle,
      })
    } catch (error) {
      sendDashboardInternalError(
        res,
        error instanceof Error
          ? error.message
          : 'Unable to build agent wallet cycle.',
      )
    }
  })
}
