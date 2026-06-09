import type express from 'express'
import { buildDashboardAgentWalletContext } from '../agentWalletContext.js'
import { requireDashboardRole } from '../access.js'
import {
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import type { DashboardRouteContext } from '../context.js'
import { readMaybeString } from '../shared.js'

export function registerAgentWalletContextRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.get('/api/dashboard/agents/:agentId/wallet-context', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner', 'operator', 'judge'],
      operation: 'agent.wallet_context.read',
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

      const [wallet, owsAccess] = await Promise.all([
        agent.walletId
          ? context.workspace.walletRegistry.get(agent.walletId)
          : Promise.resolve(undefined),
        context.workspace.owsAccessRegistry.get(agentId),
      ])

      const walletContext = await buildDashboardAgentWalletContext({
        agent,
        wallet,
        owsAccess,
        portfolioReader: context.portfolioReader,
      })

      res.json({
        ok: true,
        walletContext,
      })
    } catch (error) {
      sendDashboardInternalError(
        res,
        error instanceof Error
          ? error.message
          : 'Unable to build agent wallet context.',
      )
    }
  })
}
