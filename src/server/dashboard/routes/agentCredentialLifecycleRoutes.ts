import type express from 'express'
import { createAgentCredential } from '../../../index.js'
import { requireDashboardRole } from '../access.js'
import {
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import { recordDashboardAudit } from '../audit.js'
import type { DashboardRouteContext } from '../context.js'
import {
  beginDashboardMutationIdempotency,
  completeDashboardMutationIdempotency,
  failDashboardMutationIdempotency,
} from '../mutationIdempotency.js'
import { sanitizeCredential, stripAgentSecrets } from '../sanitizers.js'
import { readMaybeString } from '../shared.js'

export function registerAgentCredentialLifecycleRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.post('/api/dashboard/agent-credentials/:credentialId/revoke', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'agent_credential.revoke',
    })
    if (!identity) {
      return
    }

    let idempotency:
      | ReturnType<typeof beginDashboardMutationIdempotency>
      | undefined
    try {
      const credentialId = readMaybeString(req.params.credentialId)
      if (!credentialId) {
        sendDashboardApiError(res, 400, {
          code: 'invalid_request',
          message: 'Missing credential id.',
        })
        return
      }

      idempotency = beginDashboardMutationIdempotency({
        req,
        res,
        store: context.mutationIdempotency,
        identity,
        operation: 'agent_credential.revoke',
        targetId: credentialId,
        fingerprint: {
          method: 'POST',
          route: '/api/dashboard/agent-credentials/:credentialId/revoke',
          credentialId,
        },
      })
      if (!idempotency) {
        return
      }

      const credential =
        await context.workspace.agentCredentialRegistry.get(credentialId)
      if (!credential) {
        failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
        sendDashboardApiError(res, 404, {
          code: 'not_found',
          message: `Credential ${credentialId} was not found.`,
          details: {
            credentialId,
          },
        })
        return
      }

      const at = new Date().toISOString()
      const revoked = {
        ...credential,
        status: 'revoked' as const,
        updatedAt: at,
      }
      const claimed =
        await context.workspace.agentCredentialRegistry.putIfStatus(
          revoked,
          'active',
        )
      if (!claimed) {
        const current =
          await context.workspace.agentCredentialRegistry.get(credentialId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'agent_credential.revoke',
          target: {
            type: 'agent_credential',
            id: credential.credentialId,
          },
          summary: `Credential ${credential.credentialId} was already resolved before revoke completed.`,
          metadata: {
            agentId: credential.agentId,
            keyPrefix: credential.keyPrefix,
            expectedStatus: 'active',
            currentStatus: current?.status,
            errorCode: 'credential_conflict',
          },
        })
        failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
        sendDashboardApiError(res, 409, {
          code: 'credential_conflict',
          message: 'Credential was already revoked or changed.',
          details: {
            credentialId,
            currentStatus: current?.status,
          },
        })
        return
      }
      await recordDashboardAudit({
        context,
        identity,
        action: 'agent_credential.revoke',
        target: {
          type: 'agent_credential',
          id: credential.credentialId,
        },
        summary: `Revoked SDK credential ${credential.credentialId}.`,
        metadata: {
          agentId: credential.agentId,
          keyPrefix: credential.keyPrefix,
        },
      })

      const responseBody = {
        ok: true,
        credential: sanitizeCredential(revoked),
      }
      completeDashboardMutationIdempotency(context.mutationIdempotency, idempotency, {
        statusCode: 200,
        body: responseBody,
      })
      res.json(responseBody)
    } catch (error) {
      failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
      sendDashboardInternalError(res, 'Unable to revoke agent credential.')
    }
  })

  app.post('/api/dashboard/agent-credentials/:credentialId/rotate', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'agent_credential.rotate',
    })
    if (!identity) {
      return
    }

    let idempotency:
      | ReturnType<typeof beginDashboardMutationIdempotency>
      | undefined
    try {
      const credentialId = readMaybeString(req.params.credentialId)
      if (!credentialId) {
        sendDashboardApiError(res, 400, {
          code: 'invalid_request',
          message: 'Missing credential id.',
        })
        return
      }

      const label = readMaybeString(req.body?.label)
      idempotency = beginDashboardMutationIdempotency({
        req,
        res,
        store: context.mutationIdempotency,
        identity,
        operation: 'agent_credential.rotate',
        targetId: credentialId,
        fingerprint: {
          method: 'POST',
          route: '/api/dashboard/agent-credentials/:credentialId/rotate',
          credentialId,
          label,
        },
      })
      if (!idempotency) {
        return
      }

      const credential =
        await context.workspace.agentCredentialRegistry.get(credentialId)
      if (!credential) {
        failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
        sendDashboardApiError(res, 404, {
          code: 'not_found',
          message: `Credential ${credentialId} was not found.`,
          details: {
            credentialId,
          },
        })
        return
      }

      if (credential.status === 'revoked') {
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'agent_credential.rotate',
          target: {
            type: 'agent_credential',
            id: credential.credentialId,
          },
          summary: `Rejected rotation for revoked credential ${credential.credentialId}.`,
          metadata: {
            agentId: credential.agentId,
            keyPrefix: credential.keyPrefix,
            currentStatus: credential.status,
            errorCode: 'credential_conflict',
          },
        })
        failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
        sendDashboardApiError(res, 409, {
          code: 'credential_conflict',
          message: 'Revoked credentials cannot be rotated.',
          details: {
            credentialId,
            currentStatus: credential.status,
          },
        })
        return
      }

      const agent = await context.workspace.agentRegistry.get(credential.agentId)
      if (!agent) {
        failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
        sendDashboardApiError(res, 404, {
          code: 'not_found',
          message: `Agent ${credential.agentId} was not found.`,
          details: {
            agentId: credential.agentId,
          },
        })
        return
      }

      const at = new Date().toISOString()
      const revoked = {
        ...credential,
        status: 'revoked' as const,
        updatedAt: at,
      }
      const claimed =
        await context.workspace.agentCredentialRegistry.putIfStatus(
          revoked,
          'active',
        )
      if (!claimed) {
        const current =
          await context.workspace.agentCredentialRegistry.get(credentialId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'agent_credential.rotate',
          target: {
            type: 'agent_credential',
            id: credential.credentialId,
          },
          summary: `Credential ${credential.credentialId} changed before rotation completed.`,
          metadata: {
            agentId: credential.agentId,
            keyPrefix: credential.keyPrefix,
            expectedStatus: 'active',
            currentStatus: current?.status,
            errorCode: 'credential_conflict',
          },
        })
        failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
        sendDashboardApiError(res, 409, {
          code: 'credential_conflict',
          message: 'Credential was already revoked or changed.',
          details: {
            credentialId,
            currentStatus: current?.status,
          },
        })
        return
      }

      const created = await createAgentCredential(
        {
          credentials: context.workspace.agentCredentialRegistry,
        },
        {
          agentId: credential.agentId,
          label: label ?? `${credential.label} rotated`,
        },
      )
      await recordDashboardAudit({
        context,
        identity,
        action: 'agent_credential.rotate',
        target: {
          type: 'agent_credential',
          id: created.credential.credentialId,
        },
        summary: `Rotated SDK credential ${credential.credentialId}.`,
        metadata: {
          agentId: credential.agentId,
          revokedCredentialId: credential.credentialId,
          createdCredentialId: created.credential.credentialId,
          createdKeyPrefix: created.credential.keyPrefix,
        },
      })

      const responseBody = {
        ok: true,
        agent: stripAgentSecrets(agent),
        revoked: sanitizeCredential(revoked),
        credential: sanitizeCredential(created.credential),
        token: created.token,
      }
      completeDashboardMutationIdempotency(context.mutationIdempotency, idempotency, {
        statusCode: 200,
        body: responseBody,
      })
      res.json(responseBody)
    } catch (error) {
      failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
      sendDashboardInternalError(res, 'Unable to rotate agent credential.')
    }
  })
}
