import type express from 'express'
import { commitAgentLifecycleUpdate } from '../../../app/commitAgentLifecycleUpdate.js'
import { requireDashboardRole } from '../access.js'
import { sendDashboardApiError } from '../apiErrors.js'
import { recordDashboardAudit } from '../audit.js'
import type { DashboardRouteContext } from '../context.js'
import {
  beginDashboardMutationIdempotency,
  completeDashboardMutationIdempotency,
  failDashboardMutationIdempotency,
} from '../mutationIdempotency.js'
import { stripAgentSecrets } from '../sanitizers.js'
import { readMaybeString } from '../shared.js'

export function registerAgentLifecycleRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.post('/api/dashboard/agents/:agentId/actions/:action', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'agent.lifecycle.update',
    })
    if (!identity) {
      return
    }

    let idempotency:
      | ReturnType<typeof beginDashboardMutationIdempotency>
      | undefined
    try {
      const agentId = readMaybeString(req.params.agentId)
      const action = readMaybeString(req.params.action)
      if (!agentId || !action) {
        res.status(400).json({
          ok: false,
          error: 'Missing agent id or action.',
        })
        return
      }

      idempotency = beginDashboardMutationIdempotency({
        req,
        res,
        store: context.mutationIdempotency,
        identity,
        operation: 'agent.lifecycle.update',
        targetId: `${agentId}:${action}`,
        fingerprint: {
          method: 'POST',
          route: '/api/dashboard/agents/:agentId/actions/:action',
          agentId,
          action,
        },
      })
      if (!idempotency) {
        return
      }

      const agent = await context.workspace.agentRegistry.get(agentId)
      if (!agent) {
        failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
        res.status(404).json({
          ok: false,
          error: `Agent ${agentId} was not found.`,
        })
        return
      }

      const at = new Date().toISOString()
      const wallet = agent.walletId
        ? await context.workspace.walletRegistry.get(agent.walletId)
        : undefined
      let updatedAgent = agent
      let updatedWallet = wallet

      if (action === 'suspend') {
        if (wallet) {
          updatedWallet = {
            ...wallet,
            updatedAt: at,
            state: 'suspended',
          }
        }
        updatedAgent = {
          ...agent,
          updatedAt: at,
          status: 'suspended',
          trustTier: 'restricted',
          walletState: wallet ? 'suspended' : agent.walletState,
        }
      } else if (action === 'reactivate') {
        if (agent.status === 'archived') {
          failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
          res.status(409).json({
            ok: false,
            error: 'Archived agents cannot be reactivated.',
          })
          return
        }
        if (wallet) {
          updatedWallet = {
            ...wallet,
            updatedAt: at,
            state: 'active_limited',
          }
        }
        updatedAgent = {
          ...agent,
          updatedAt: at,
          status: 'ready',
          trustTier: agent.trustTier === 'restricted' ? 'new' : agent.trustTier,
          walletState: wallet ? 'active_limited' : agent.walletState,
          lastCheckInAt: at,
        }
      } else if (action === 'archive') {
        if (wallet) {
          updatedWallet = {
            ...wallet,
            updatedAt: at,
            state: 'closed',
          }
        }
        updatedAgent = {
          ...agent,
          updatedAt: at,
          status: 'archived',
          trustTier: 'restricted',
          walletState: wallet ? 'closed' : agent.walletState,
        }
      } else {
        failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
        res.status(400).json({
          ok: false,
          error: 'Unsupported agent action.',
        })
        return
      }

      const committed = await commitAgentLifecycleUpdate({
        workspace: context.workspace,
        previousAgent: agent,
        nextAgent: updatedAgent,
        previousWallet: wallet,
        nextWallet: updatedWallet,
      })
      if (!committed.ok) {
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'agent.lifecycle.update',
          target: {
            type: 'agent',
            id: agent.agentId,
          },
          summary: `Agent ${agent.agentId} changed while lifecycle update was in progress.`,
          metadata: {
            action,
            expectedUpdatedAt: agent.updatedAt,
            currentUpdatedAt:
              committed.code === 'wallet_conflict'
                ? committed.currentWallet?.updatedAt
                : committed.currentAgent?.updatedAt,
            currentStatus:
              committed.code === 'wallet_conflict'
                ? committed.currentWallet?.state
                : committed.currentAgent?.status,
            walletId: wallet?.walletId,
            errorCode: committed.code,
          },
        })
        sendDashboardApiError(res, 409, {
          code: committed.code,
          message:
            committed.code === 'wallet_conflict'
              ? 'Agent wallet changed while the lifecycle update was in progress.'
              : 'Agent changed while the lifecycle update was in progress.',
          details: {
            agentId,
            walletId: wallet?.walletId,
            currentUpdatedAt:
              committed.code === 'wallet_conflict'
                ? committed.currentWallet?.updatedAt
                : committed.currentAgent?.updatedAt,
            currentStatus:
              committed.code === 'wallet_conflict'
                ? committed.currentWallet?.state
                : committed.currentAgent?.status,
          },
        })
        return
      }
      const snapshot = await context.buildDashboardSnapshot()
      await recordDashboardAudit({
        context,
        identity,
        action: 'agent.lifecycle.update',
        target: {
          type: 'agent',
          id: agent.agentId,
        },
        summary: `Updated lifecycle for agent ${agent.agentId}: ${action}.`,
        metadata: {
          action,
          previousStatus: agent.status,
          nextStatus: updatedAgent.status,
          walletId: agent.walletId,
        },
      })

      const responseBody = {
        ok: true,
        agent: stripAgentSecrets(updatedAgent),
        snapshot,
      }
      completeDashboardMutationIdempotency(context.mutationIdempotency, idempotency, {
        statusCode: 200,
        body: responseBody,
      })
      res.json(responseBody)
    } catch (error) {
      failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to update agent lifecycle.',
      })
    }
  })
}
