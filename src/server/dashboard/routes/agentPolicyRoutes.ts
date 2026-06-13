import type express from 'express'
import {
  readAgentPrivacyModeFromInput,
  updateAgentPrivacyMode,
} from '../../../app/agentPrivacyMode.js'
import {
  requestWalletPolicyUpdate,
} from '../../../app/requestWalletPolicyUpdate.js'
import { requireDashboardRole } from '../access.js'
import {
  buildDashboardApiError,
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import { recordDashboardAudit } from '../audit.js'
import {
  readAgentSettlementModePatch,
  updateAgentSettlementMode,
} from '../agentSettlementMode.js'
import type { DashboardRouteContext } from '../context.js'
import {
  beginDashboardMutationIdempotency,
  completeDashboardMutationIdempotency,
  failDashboardMutationIdempotency,
} from '../mutationIdempotency.js'
import { stripAgentSecrets } from '../sanitizers.js'
import { buildAgentSettlementReadiness } from '../settlementReadiness.js'
import { readAgentPolicyPatch } from '../serviceInput.js'
import { readMaybeString } from '../shared.js'

export function registerAgentPolicyRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.patch('/api/dashboard/agents/:agentId/policy', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'agent.policy.update',
    })
    if (!identity) {
      return
    }

    let idempotency:
      | ReturnType<typeof beginDashboardMutationIdempotency>
      | undefined
    try {
      const agentId = readMaybeString(req.params.agentId)
      if (!agentId) {
        sendDashboardApiError(res, 400, {
          code: 'invalid_request',
          message: 'Missing agent id.',
        })
        return
      }

      const patch = readAgentPolicyPatch(req.body)
      idempotency = beginDashboardMutationIdempotency({
        req,
        res,
        store: context.mutationIdempotency,
        identity,
        operation: 'agent.policy.update',
        targetId: agentId,
        fingerprint: {
          method: 'PATCH',
          route: '/api/dashboard/agents/:agentId/policy',
          agentId,
          patch,
        },
      })
      if (!idempotency) {
        return
      }

      const result = await requestWalletPolicyUpdate(
        {
          agentRegistry: context.workspace.agentRegistry,
          actionRequests: context.workspace.actionRequestRegistry,
        },
        {
          agentId,
          patch,
          actorId: identity.actorId,
          operatorRole: identity.role,
        },
      )

      if (result.kind === 'not_found') {
        const responseBody = buildDashboardApiError({
          code: 'not_found',
          message: result.message,
          details: {
            agentId,
          },
        })
        completeDashboardMutationIdempotency(
          context.mutationIdempotency,
          idempotency,
          {
            statusCode: 404,
            body: responseBody,
          },
        )
        res.status(404).json(responseBody)
        return
      }

      if (result.kind === 'blocked') {
        const responseBody = {
          ok: false,
          error: result.message,
        }
        completeDashboardMutationIdempotency(
          context.mutationIdempotency,
          idempotency,
          {
            statusCode: result.httpStatus,
            body: responseBody,
          },
        )
        res.status(result.httpStatus).json(responseBody)
        return
      }

      if (result.kind === 'conflict') {
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'agent.policy.update',
          target: {
            type: 'agent',
            id: result.agent.agentId,
          },
          summary: `Agent ${result.agent.agentId} changed while policy update was in progress.`,
          metadata: {
            expectedUpdatedAt: result.agent.updatedAt,
            currentUpdatedAt: result.currentAgent?.updatedAt,
            currentStatus: result.currentAgent?.status,
            errorCode: 'agent_conflict',
            actionRequestId: result.actionRequest?.actionRequestId,
            actionRequestKind: result.actionRequest?.kind,
          },
        })
        const responseBody = buildDashboardApiError({
          code: 'agent_conflict',
          message: 'Agent changed while the policy update was in progress.',
          details: {
            agentId,
            currentUpdatedAt: result.currentAgent?.updatedAt,
            currentStatus: result.currentAgent?.status,
          },
        })
        completeDashboardMutationIdempotency(
          context.mutationIdempotency,
          idempotency,
          {
            statusCode: 409,
            body: responseBody,
          },
        )
        res.status(409).json(responseBody)
        return
      }

      const snapshot = await context.buildDashboardSnapshot()
      await recordDashboardAudit({
        context,
        identity,
        action: 'agent.policy.update',
        target: {
          type: 'agent',
          id: result.agent.agentId,
        },
        summary: `Updated policy for agent ${result.agent.agentId}.`,
        metadata: {
          maxPerTransaction: result.plan.nextMax,
          autoApproveUnder: result.plan.nextAuto,
          sessionBudget: result.plan.nextBudget,
          heartbeatTimeoutSeconds: result.plan.nextHeartbeatTimeoutSeconds,
          transferPolicyUpdated: Boolean(patch.transferPolicy),
          allowedRecipientCount:
            result.agent.policyConfig.transferPolicy?.allowedRecipients?.length,
          allowedAssets:
            result.agent.policyConfig.transferPolicy?.allowedAssets,
          allowedChains:
            result.agent.policyConfig.transferPolicy?.allowedChains,
          actionRequestId: result.actionRequest?.actionRequestId,
          actionRequestKind: result.actionRequest?.kind,
        },
      })

      const responseBody = {
        ok: true,
        agent: stripAgentSecrets(result.agent),
        snapshot,
      }
      completeDashboardMutationIdempotency(
        context.mutationIdempotency,
        idempotency,
        {
          statusCode: 200,
          body: responseBody,
        },
      )
      res.json(responseBody)
    } catch (error) {
      failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to update agent policy.',
      })
    }
  })

  app.patch('/api/dashboard/agents/:agentId/settlement', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'agent.settlement.update',
    })
    if (!identity) {
      return
    }

    try {
      const agentId = readMaybeString(req.params.agentId)
      if (!agentId) {
        sendDashboardApiError(res, 400, {
          code: 'invalid_request',
          message: 'Missing agent id.',
        })
        return
      }

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

      const result = updateAgentSettlementMode({
        agent,
        ...readAgentSettlementModePatch(req.body),
      })
      if (!result.ok) {
        sendDashboardApiError(res, 400, {
          code: 'invalid_request',
          message: result.message,
          details: {
            reason: result.code,
          },
        })
        return
      }

      const saved = await context.workspace.agentRegistry.putIfUpdatedAt(
        result.agent,
        agent.updatedAt,
      )
      if (!saved) {
        const current = await context.workspace.agentRegistry.get(agentId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'agent.settlement.update',
          target: {
            type: 'agent',
            id: agent.agentId,
          },
          summary: `Agent ${agent.agentId} changed while settlement update was in progress.`,
          metadata: {
            expectedUpdatedAt: agent.updatedAt,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
            errorCode: 'agent_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'agent_conflict',
          message: 'Agent changed while the settlement update was in progress.',
          details: {
            agentId,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
          },
        })
        return
      }
      const wallet = result.agent.walletId
        ? await context.workspace.walletRegistry.get(result.agent.walletId)
        : undefined
      const readiness = buildAgentSettlementReadiness({
        agent: result.agent,
        wallet,
        owsClient: context.owsClient,
        env: context.env,
      })
      const snapshot = await context.buildDashboardSnapshot()
      await recordDashboardAudit({
        context,
        identity,
        action: 'agent.settlement.update',
        target: {
          type: 'agent',
          id: result.agent.agentId,
        },
        summary: `Updated settlement mode for agent ${result.agent.agentId}: ${result.nextSettlementMode}.`,
        metadata: {
          changed: result.changed,
          previousSettlementMode: result.previousSettlementMode,
          nextSettlementMode: result.nextSettlementMode,
          readinessStatus: readiness.status,
          readinessChecks: readiness.checks.map((check) => check.code),
        },
      })

      res.json({
        ok: true,
        changed: result.changed,
        agent: stripAgentSecrets(result.agent),
        readiness,
        snapshot,
      })
    } catch (error) {
      sendDashboardInternalError(
        res,
        error instanceof Error
          ? error.message
          : 'Unable to update agent settlement mode.',
      )
    }
  })

  app.patch('/api/dashboard/agents/:agentId/privacy', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'agent.privacy.update',
    })
    if (!identity) {
      return
    }

    try {
      const agentId = readMaybeString(req.params.agentId)
      if (!agentId) {
        sendDashboardApiError(res, 400, {
          code: 'invalid_request',
          message: 'Missing agent id.',
        })
        return
      }

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

      const result = updateAgentPrivacyMode({
        agent,
        privacyMode: readAgentPrivacyModeFromInput(req.body),
      })
      if (!result.ok) {
        sendDashboardApiError(res, 400, {
          code: 'invalid_request',
          message: result.message,
          details: {
            reason: result.code,
          },
        })
        return
      }

      const saved = await context.workspace.agentRegistry.putIfUpdatedAt(
        result.agent,
        agent.updatedAt,
      )
      if (!saved) {
        const current = await context.workspace.agentRegistry.get(agentId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'agent.privacy.update',
          target: {
            type: 'agent',
            id: agent.agentId,
          },
          summary: `Agent ${agent.agentId} changed while privacy update was in progress.`,
          metadata: {
            expectedUpdatedAt: agent.updatedAt,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
            errorCode: 'agent_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'agent_conflict',
          message: 'Agent changed while the privacy update was in progress.',
          details: {
            agentId,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
          },
        })
        return
      }
      const wallet = result.agent.walletId
        ? await context.workspace.walletRegistry.get(result.agent.walletId)
        : undefined
      const readiness = buildAgentSettlementReadiness({
        agent: result.agent,
        wallet,
        owsClient: context.owsClient,
        env: context.env,
      })
      const snapshot = await context.buildDashboardSnapshot()
      await recordDashboardAudit({
        context,
        identity,
        action: 'agent.privacy.update',
        target: {
          type: 'agent',
          id: result.agent.agentId,
        },
        summary: `Updated privacy mode for agent ${result.agent.agentId}: ${result.nextPrivacyMode}.`,
        metadata: {
          changed: result.changed,
          previousPrivacyMode: result.previousPrivacyMode,
          nextPrivacyMode: result.nextPrivacyMode,
          umbraPolicyAttached: Boolean(result.agent.policyConfig.umbra),
          readinessStatus: readiness.status,
          readinessChecks: readiness.checks.map((check) => check.code),
        },
      })

      res.json({
        ok: true,
        changed: result.changed,
        agent: stripAgentSecrets(result.agent),
        privacyMode: result.nextPrivacyMode,
        readiness,
        snapshot,
      })
    } catch (error) {
      sendDashboardInternalError(
        res,
        error instanceof Error
          ? error.message
          : 'Unable to update agent privacy mode.',
      )
    }
  })
}
