import type express from 'express'
import { OpenAIResearchAgent, runPusdResearchWorker } from '../../../index.js'
import { requireDashboardRole } from '../access.js'
import { recordDashboardAudit } from '../audit.js'
import type { DashboardRouteContext } from '../context.js'
import { sanitizeWorkerResult } from '../sanitizers.js'
import { readMaybeString } from '../shared.js'

export function registerAgentRunRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.post('/api/dashboard/agents/:agentId/run', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'agent.run',
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

      const result = await runSelectedAgent(context, agentId, req.body?.task)
      const snapshot = await context.buildDashboardSnapshot()
      await recordDashboardAudit({
        context,
        identity,
        action: 'agent.run',
        target: {
          type: 'agent',
          id: agentId,
        },
        summary: `Ran agent ${agentId}.`,
        metadata: {
          executionId: result.execution.execution.executionId,
          status: result.execution.execution.status,
          resultKind: result.execution.kind,
        },
      })

      res.json({
        ok: true,
        result: sanitizeWorkerResult(result),
        snapshot,
      })
    } catch (error) {
      res.status(error instanceof RouteError ? error.status : 500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to run the PalmOS agent.',
      })
    }
  })

  app.post('/api/dashboard/worker/run', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'worker.run',
    })
    if (!identity) {
      return
    }

    try {
      const agentId = readMaybeString(req.body?.agentId)
      if (!agentId) {
        res.status(400).json({
          ok: false,
          error: 'Select or register an external agent before running PalmOS.',
        })
        return
      }

      const result = await runSelectedAgent(context, agentId, req.body?.task)
      const snapshot = await context.buildDashboardSnapshot()
      await recordDashboardAudit({
        context,
        identity,
        action: 'agent.run',
        target: {
          type: 'agent',
          id: agentId,
        },
        summary: `Ran worker for agent ${agentId}.`,
        metadata: {
          executionId: result.execution.execution.executionId,
          status: result.execution.execution.status,
          resultKind: result.execution.kind,
        },
      })

      res.json({
        ok: true,
        result: sanitizeWorkerResult(result),
        snapshot,
      })
    } catch (error) {
      res.status(error instanceof RouteError ? error.status : 500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to run the PalmOS worker.',
      })
    }
  })
}

class RouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'RouteError'
  }
}

async function runSelectedAgent(
  context: DashboardRouteContext,
  agentId: string,
  task: unknown,
) {
  const agent = await context.workspace.agentRegistry.get(agentId)
  if (!agent) {
    throw new RouteError(404, `Agent ${agentId} was not found.`)
  }

  if (agent.status === 'suspended' || agent.status === 'archived') {
    throw new RouteError(
      409,
      `Agent ${agentId} is ${agent.status} and cannot run paid calls.`,
    )
  }

  return runPusdResearchWorker({
    baseDir: context.baseDir,
    workspace: context.workspace,
    palmosClient: context.palmosClient,
    owsClient: context.owsClient,
    xmtpNotifier: context.xmtpNotifier,
    serviceCatalog: await context.buildPalmosServiceCatalog(),
    brain: OpenAIResearchAgent.fromEnv(context.env),
    env: context.env,
    agentId,
    task: readMaybeString(task),
  })
}
