import type express from 'express'
import { createAgentCredential } from '../../../index.js'
import { requireDashboardRole } from '../access.js'
import {
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import { recordDashboardAudit } from '../audit.js'
import type { DashboardRouteContext } from '../context.js'
import { sanitizeCredential, stripAgentSecrets } from '../sanitizers.js'
import { readMaybeString } from '../shared.js'

export function registerAgentCredentialManagementRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.get('/api/dashboard/agents/:agentId/credentials', async (req, res) => {
    try {
      const agentId = readMaybeString(req.params.agentId)
      if (!agentId) {
        res.status(400).json({
          ok: false,
          error: 'Missing agent id.',
        })
        return
      }

      const agent = await context.workspace.agentRegistry.get(agentId)
      if (!agent) {
        res.status(404).json({
          ok: false,
          error: `Agent ${agentId} was not found.`,
        })
        return
      }

      const credentials =
        await context.workspace.agentCredentialRegistry.listByAgent(agentId)
      res.json({
        ok: true,
        agent: stripAgentSecrets(agent),
        credentials: credentials.map(sanitizeCredential),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to list agent credentials.',
      })
    }
  })

  app.post('/api/dashboard/agents/:agentId/credentials', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'agent_credential.create',
    })
    if (!identity) {
      return
    }

    try {
      const agentId = readMaybeString(req.params.agentId)
      if (!agentId) {
        res.status(400).json({
          ok: false,
          error: 'Missing agent id.',
        })
        return
      }

      const agent = await context.workspace.agentRegistry.get(agentId)
      if (!agent) {
        res.status(404).json({
          ok: false,
          error: `Agent ${agentId} was not found.`,
        })
        return
      }

      const created = await createAgentCredential(
        {
          credentials: context.workspace.agentCredentialRegistry,
        },
        {
          agentId,
          label: readMaybeString(req.body?.label) ?? 'SDK key',
        },
      )
      await recordDashboardAudit({
        context,
        identity,
        action: 'agent_credential.create',
        target: {
          type: 'agent_credential',
          id: created.credential.credentialId,
        },
        summary: `Created SDK credential ${created.credential.credentialId} for agent ${agentId}.`,
        metadata: {
          agentId,
          keyPrefix: created.credential.keyPrefix,
          label: created.credential.label,
        },
      })

      res.json({
        ok: true,
        agent: stripAgentSecrets(agent),
        credential: sanitizeCredential(created.credential),
        token: created.token,
      })
    } catch (error) {
      sendDashboardInternalError(res, 'Unable to create agent credential.')
    }
  })

  app.patch('/api/dashboard/agent-credentials/:credentialId', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'agent_credential.update',
    })
    if (!identity) {
      return
    }

    try {
      const credentialId = readMaybeString(req.params.credentialId)
      if (!credentialId) {
        sendDashboardApiError(res, 400, {
          code: 'invalid_request',
          message: 'Missing credential id.',
        })
        return
      }

      const credential =
        await context.workspace.agentCredentialRegistry.get(credentialId)
      if (!credential) {
        sendDashboardApiError(res, 404, {
          code: 'not_found',
          message: `Credential ${credentialId} was not found.`,
          details: {
            credentialId,
          },
        })
        return
      }

      const label = readMaybeString(req.body?.label)
      if (!label) {
        sendDashboardApiError(res, 400, {
          code: 'invalid_request',
          message: 'Missing credential label.',
        })
        return
      }

      const updated = {
        ...credential,
        label,
        updatedAt: new Date().toISOString(),
      }
      const updatedCredential =
        await context.workspace.agentCredentialRegistry.putIfStatus(
          updated,
          credential.status,
        )
      if (!updatedCredential) {
        const current =
          await context.workspace.agentCredentialRegistry.get(credentialId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'agent_credential.update',
          target: {
            type: 'agent_credential',
            id: credential.credentialId,
          },
          summary: `Credential ${credential.credentialId} changed while update was in progress.`,
          metadata: {
            agentId: credential.agentId,
            expectedStatus: credential.status,
            currentStatus: current?.status,
            errorCode: 'credential_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'credential_conflict',
          message: 'Credential changed while the update was in progress.',
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
        action: 'agent_credential.update',
        target: {
          type: 'agent_credential',
          id: credential.credentialId,
        },
        summary: `Updated SDK credential ${credential.credentialId}.`,
        metadata: {
          agentId: credential.agentId,
          previousLabel: credential.label,
          label,
        },
      })

      res.json({
        ok: true,
        credential: sanitizeCredential(updated),
      })
    } catch (error) {
      sendDashboardInternalError(res, 'Unable to update agent credential.')
    }
  })
}
