import type express from 'express'
import {
  checkPusdPaymentReadiness,
  AssetTransferApprovalConflictError,
  PaidCallApprovalConflictError,
  readPusdMintFromEnv,
  readSolanaRpcUrlFromEnv,
  resolvePendingAssetTransferApproval,
  resolvePendingPaidCallApproval,
  runDashboardScenario,
} from '../../../index.js'
import {
  buildDashboardAccessCapabilities,
  readDashboardAccessIdentity,
  readDashboardSessionIdentity,
  readDashboardWorkspaceId,
  requireDashboardRole,
} from '../access.js'
import {
  buildDashboardAdminExport,
  createDashboardExportFilename,
} from '../adminExport.js'
import {
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import { recordDashboardAudit } from '../audit.js'
import { isShowcaseRunEnabled } from '../config.js'
import type { DashboardRouteContext } from '../context.js'
import {
  beginDashboardMutationIdempotency,
  completeDashboardMutationIdempotency,
  failDashboardMutationIdempotency,
} from '../mutationIdempotency.js'
import {
  createDashboardOperatorRecord,
  readDashboardOperatorPatch,
  sanitizeDashboardOperator,
  setDashboardOperatorStatus,
} from '../operatorLifecycle.js'
import { buildDashboardOperationalMetrics } from '../operationalMetrics.js'
import { evaluateDashboardOperationalAlerts } from '../operationalAlerts.js'
import { buildDashboardSettlementReadiness } from '../settlementReadiness.js'
import { readMaybeString } from '../shared.js'
import { runDashboardStorageMaintenance } from '../storageMaintenance.js'
import { buildDashboardStorageStatus } from '../storageStatus.js'
import { buildDashboardSystemHealth } from '../systemHealth.js'
import {
  applyDashboardWorkspacePatch,
  ensureDashboardWorkspaceRecord,
  readDashboardWorkspacePatch,
} from '../workspaceSettings.js'

function isApprovalConflictError(
  error: unknown,
): error is PaidCallApprovalConflictError | AssetTransferApprovalConflictError {
  return (
    error instanceof PaidCallApprovalConflictError ||
    error instanceof AssetTransferApprovalConflictError ||
    (error instanceof Error &&
      (error.name === 'PaidCallApprovalConflictError' ||
        error.name === 'AssetTransferApprovalConflictError') &&
      'code' in error &&
      error.code === 'approval_conflict')
  )
}

export function registerSystemRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.get('/api/dashboard/health', async (_req, res) => {
    const snapshot = await context.buildDashboardSnapshot()
    res.json({
      ok: true,
      baseDir: context.baseDir,
      agentCount: snapshot.summary.agentCount,
      pendingCalls: snapshot.summary.approvalPendingCalls,
      localDemoBaseUrl: context.localDemoBaseUrl,
      localPusdServer: Boolean(context.localServer),
    })
  })

  app.get('/api/dashboard/system/health', async (_req, res) => {
    const health = await buildDashboardSystemHealth(context)
    const metrics = await buildDashboardOperationalMetrics({
      paidCalls: context.workspace.paidCallRegistry,
      actionRequests: context.workspace.actionRequestRegistry,
      credentials: context.workspace.agentCredentialRegistry,
      readinessReports: context.pusdReadinessReports,
      processMetrics: context.operationalMetrics,
    })
    await context.operationalAlerts?.dispatch(
      evaluateDashboardOperationalAlerts({
        env: context.env,
        metrics,
        health,
      }),
    )
    res.json(health)
  })

  app.get('/api/dashboard/system/metrics', async (_req, res) => {
    const health = await buildDashboardSystemHealth(context)
    const metrics = await buildDashboardOperationalMetrics({
      paidCalls: context.workspace.paidCallRegistry,
      actionRequests: context.workspace.actionRequestRegistry,
      credentials: context.workspace.agentCredentialRegistry,
      readinessReports: context.pusdReadinessReports,
      processMetrics: context.operationalMetrics,
    })
    await context.operationalAlerts?.dispatch(
      evaluateDashboardOperationalAlerts({
        env: context.env,
        metrics,
        health,
      }),
    )
    res.json(metrics)
  })

  app.get('/api/dashboard/system/settlement-readiness', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner', 'operator'],
      operation: 'settlement.readiness',
    })
    if (!identity) {
      return
    }

    try {
      res.json(
        await buildDashboardSettlementReadiness({
          workspace: context.workspace,
          serviceCatalog: await context.buildPalmosServiceCatalog(),
          owsClient: context.owsClient,
          env: context.env,
          defaultRecipient:
            context.env.PUSD_MERCHANT_WALLET?.trim() ??
            context.localServer?.payToAddress,
        }),
      )
    } catch (error) {
      sendDashboardInternalError(
        res,
        error instanceof Error
          ? error.message
          : 'Unable to build settlement readiness report.',
      )
    }
  })

  app.get('/api/dashboard/session', async (req, res) => {
    const identity = readDashboardSessionIdentity({
      req,
      env: context.env,
    })
    const capabilities = buildDashboardAccessCapabilities({
      identity,
      env: context.env,
    })
    const operators = await context.workspace.dashboardOperatorRegistry.list()
    const workspace = await ensureDashboardWorkspaceRecord({
      registry: context.workspace.dashboardWorkspaceRegistry,
      env: context.env,
    })

    res.json({
      ok: true,
      workspaceId: identity?.workspaceId ?? readDashboardWorkspaceId(context.env),
      workspace,
      identity: identity
        ? {
            operatorId: identity.operatorId,
            workspaceId: identity.workspaceId,
            actorId: identity.actorId,
            role: identity.role,
            source: identity.source,
            expiresAt: identity.expiresAt,
          }
        : undefined,
      capabilities,
      operators: operators
        .filter((operator) => operator.workspaceId === workspace.workspaceId)
        .map(sanitizeDashboardOperator),
    })
  })

  app.get('/api/dashboard/operators', async (_req, res) => {
    const workspace = await ensureDashboardWorkspaceRecord({
      registry: context.workspace.dashboardWorkspaceRegistry,
      env: context.env,
    })
    const operators = await context.workspace.dashboardOperatorRegistry.list()
    res.json({
      ok: true,
      operators: operators
        .filter((operator) => operator.workspaceId === workspace.workspaceId)
        .map(sanitizeDashboardOperator),
    })
  })

  app.post('/api/dashboard/operators', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner'],
      operation: 'operator.create',
    })
    if (!identity) {
      return
    }

    try {
      const patch = readDashboardOperatorPatch(req.body)
      const existing = patch.operatorId
        ? await context.workspace.dashboardOperatorRegistry.get(patch.operatorId)
        : undefined
      if (existing) {
        res.status(409).json({
          ok: false,
          error: `Operator ${existing.operatorId} already exists.`,
        })
        return
      }

      const operator = createDashboardOperatorRecord({
        env: context.env,
        patch,
      })
      if (!operator) {
        res.status(400).json({
          ok: false,
          error: 'Missing operatorId.',
        })
        return
      }

      await context.workspace.dashboardOperatorRegistry.put(operator)
      await recordDashboardAudit({
        context,
        identity,
        action: 'operator.create',
        target: {
          type: 'operator',
          id: operator.operatorId,
        },
        summary: `Created operator ${operator.operatorId}.`,
        metadata: sanitizeDashboardOperator(operator),
      })

      res.json({
        ok: true,
        operator: sanitizeDashboardOperator(operator),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to create dashboard operator.',
      })
    }
  })

  app.patch('/api/dashboard/operators/:operatorId', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner'],
      operation: 'operator.update',
    })
    if (!identity) {
      return
    }

    try {
      const operatorId = readMaybeString(req.params.operatorId)
      if (!operatorId) {
        res.status(400).json({
          ok: false,
          error: 'Missing operator id.',
        })
        return
      }

      const existing = await context.workspace.dashboardOperatorRegistry.get(operatorId)
      if (!existing) {
        res.status(404).json({
          ok: false,
          error: `Operator ${operatorId} was not found.`,
        })
        return
      }

      const operator = createDashboardOperatorRecord({
        env: context.env,
        patch: readDashboardOperatorPatch(req.body),
        existing,
      })
      if (!operator) {
        res.status(400).json({
          ok: false,
          error: 'Invalid operator patch.',
        })
        return
      }

      const saved =
        await context.workspace.dashboardOperatorRegistry.putIfUpdatedAt(
          operator,
          existing.updatedAt,
        )
      if (!saved) {
        const current =
          await context.workspace.dashboardOperatorRegistry.get(operatorId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'operator.update',
          target: {
            type: 'operator',
            id: existing.operatorId,
          },
          summary: `Operator ${existing.operatorId} changed while update was in progress.`,
          metadata: {
            expectedUpdatedAt: existing.updatedAt,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
            errorCode: 'operator_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'operator_conflict',
          message: 'Operator changed while the update was in progress.',
          details: {
            operatorId,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
          },
        })
        return
      }
      await recordDashboardAudit({
        context,
        identity,
        action: 'operator.update',
        target: {
          type: 'operator',
          id: operator.operatorId,
        },
        summary: `Updated operator ${operator.operatorId}.`,
        metadata: sanitizeDashboardOperator(operator),
      })

      res.json({
        ok: true,
        operator: sanitizeDashboardOperator(operator),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to update dashboard operator.',
      })
    }
  })

  app.post('/api/dashboard/operators/:operatorId/disable', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner'],
      operation: 'operator.disable',
    })
    if (!identity) {
      return
    }

    try {
      const operatorId = readMaybeString(req.params.operatorId)
      if (!operatorId) {
        res.status(400).json({
          ok: false,
          error: 'Missing operator id.',
        })
        return
      }
      if (operatorId === identity.operatorId) {
        res.status(400).json({
          ok: false,
          error: 'Current operator cannot disable their own account.',
        })
        return
      }

      const existing = await context.workspace.dashboardOperatorRegistry.get(operatorId)
      if (!existing) {
        res.status(404).json({
          ok: false,
          error: `Operator ${operatorId} was not found.`,
        })
        return
      }

      const operator = setDashboardOperatorStatus({
        operator: existing,
        status: 'disabled',
      })
      const saved =
        await context.workspace.dashboardOperatorRegistry.putIfUpdatedAt(
          operator,
          existing.updatedAt,
        )
      if (!saved) {
        const current =
          await context.workspace.dashboardOperatorRegistry.get(operatorId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'operator.disable',
          target: {
            type: 'operator',
            id: existing.operatorId,
          },
          summary: `Operator ${existing.operatorId} changed while disable was in progress.`,
          metadata: {
            expectedUpdatedAt: existing.updatedAt,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
            errorCode: 'operator_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'operator_conflict',
          message: 'Operator changed while disable was in progress.',
          details: {
            operatorId,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
          },
        })
        return
      }
      await recordDashboardAudit({
        context,
        identity,
        action: 'operator.disable',
        target: {
          type: 'operator',
          id: operator.operatorId,
        },
        summary: `Disabled operator ${operator.operatorId}.`,
        metadata: sanitizeDashboardOperator(operator),
      })

      res.json({
        ok: true,
        operator: sanitizeDashboardOperator(operator),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to disable dashboard operator.',
      })
    }
  })

  app.post('/api/dashboard/operators/:operatorId/enable', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner'],
      operation: 'operator.enable',
    })
    if (!identity) {
      return
    }

    try {
      const operatorId = readMaybeString(req.params.operatorId)
      if (!operatorId) {
        res.status(400).json({
          ok: false,
          error: 'Missing operator id.',
        })
        return
      }

      const existing = await context.workspace.dashboardOperatorRegistry.get(operatorId)
      if (!existing) {
        res.status(404).json({
          ok: false,
          error: `Operator ${operatorId} was not found.`,
        })
        return
      }

      const operator = setDashboardOperatorStatus({
        operator: existing,
        status: 'active',
      })
      const saved =
        await context.workspace.dashboardOperatorRegistry.putIfUpdatedAt(
          operator,
          existing.updatedAt,
        )
      if (!saved) {
        const current =
          await context.workspace.dashboardOperatorRegistry.get(operatorId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'operator.enable',
          target: {
            type: 'operator',
            id: existing.operatorId,
          },
          summary: `Operator ${existing.operatorId} changed while enable was in progress.`,
          metadata: {
            expectedUpdatedAt: existing.updatedAt,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
            errorCode: 'operator_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'operator_conflict',
          message: 'Operator changed while enable was in progress.',
          details: {
            operatorId,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
          },
        })
        return
      }
      await recordDashboardAudit({
        context,
        identity,
        action: 'operator.enable',
        target: {
          type: 'operator',
          id: operator.operatorId,
        },
        summary: `Enabled operator ${operator.operatorId}.`,
        metadata: sanitizeDashboardOperator(operator),
      })

      res.json({
        ok: true,
        operator: sanitizeDashboardOperator(operator),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to enable dashboard operator.',
      })
    }
  })

  app.patch('/api/dashboard/workspace', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'workspace.update',
    })
    if (!identity) {
      return
    }

    try {
      const workspace = await ensureDashboardWorkspaceRecord({
        registry: context.workspace.dashboardWorkspaceRegistry,
        env: context.env,
      })
      const patch = readDashboardWorkspacePatch(req.body)
      const updated = applyDashboardWorkspacePatch({
        workspace,
        patch,
      })
      const saved =
        await context.workspace.dashboardWorkspaceRegistry.putIfUpdatedAt(
          updated,
          workspace.updatedAt,
        )
      if (!saved) {
        const current =
          await context.workspace.dashboardWorkspaceRegistry.get(
            workspace.workspaceId,
          )
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'workspace.update',
          target: {
            type: 'workspace',
            id: workspace.workspaceId,
          },
          summary: `Workspace ${workspace.workspaceId} changed while update was in progress.`,
          metadata: {
            expectedUpdatedAt: workspace.updatedAt,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
            errorCode: 'workspace_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'workspace_conflict',
          message: 'Workspace changed while the update was in progress.',
          details: {
            workspaceId: workspace.workspaceId,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
          },
        })
        return
      }
      await recordDashboardAudit({
        context,
        identity,
        action: 'workspace.update',
        target: {
          type: 'workspace',
          id: updated.workspaceId,
        },
        summary: `Updated workspace ${updated.workspaceId}.`,
        metadata: {
          displayName: updated.displayName,
          settings: updated.settings,
        },
      })

      res.json({
        ok: true,
        workspace: updated,
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to update PalmOS workspace.',
      })
    }
  })

  app.get('/api/dashboard/audit', async (req, res) => {
    const limit = Number(readMaybeString(req.query.limit))
    const normalizedLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(Math.round(limit), 250) : 100
    const records = await context.workspace.dashboardAuditLogRegistry.list()

    res.json({
      ok: true,
      audit: records
        .sort((left, right) => right.at.localeCompare(left.at))
        .slice(0, normalizedLimit),
    })
  })

  app.get('/api/dashboard/export', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner'],
      operation: 'workspace.export',
    })
    if (!identity) {
      return
    }

    try {
      const adminExport = await buildDashboardAdminExport({
        env: context.env,
        workspace: {
          ...context.workspace,
          actionRequestRegistry: context.workspace.actionRequestRegistry,
        },
      })
      await recordDashboardAudit({
        context,
        identity,
        action: 'workspace.export',
        target: {
          type: 'workspace',
          id: adminExport.workspace.workspaceId,
        },
        summary: `Exported workspace ${adminExport.workspace.workspaceId} audit and transaction history.`,
        metadata: adminExport.summary,
      })

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${createDashboardExportFilename({
          workspaceId: adminExport.workspace.workspaceId,
          exportedAt: adminExport.exportedAt,
        })}"`,
      )
      res.json({
        ok: true,
        export: adminExport,
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to export PalmOS audit and transaction history.',
      })
    }
  })

  app.post('/api/dashboard/control/dead-man-sweep', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'control.dead_man_sweep',
    })
    if (!identity) {
      return
    }

    await context.runDashboardDeadMansSwitchSweep()
    const snapshot = await context.buildDashboardSnapshot()
    await recordDashboardAudit({
      context,
      identity,
      action: 'control.dead_man_sweep',
      target: {
        type: 'control',
        id: 'dead_man_sweep',
      },
      summary: 'Ran dashboard dead-man sweep.',
      metadata: {
        agentCount: snapshot.summary.agentCount,
        staleAgents: snapshot.summary.staleAgents,
      },
    })
    res.json({
      ok: true,
      snapshot,
    })
  })

  app.post('/api/dashboard/storage/maintenance', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'storage.maintenance',
    })
    if (!identity) {
      return
    }

    const result = await runDashboardStorageMaintenance(context)
    await recordDashboardAudit({
      context,
      identity,
      action: 'storage.maintenance',
      target: {
        type: 'storage',
        id: 'dashboard_file_storage',
      },
      summary: 'Ran dashboard file storage maintenance.',
      metadata: result,
    })

    res.json({
      ok: true,
      result,
    })
  })

  app.get('/api/dashboard/storage/status', async (_req, res) => {
    res.json(await buildDashboardStorageStatus(context))
  })

  app.get('/api/dashboard/snapshot', async (_req, res) => {
    const snapshot = await context.buildDashboardSnapshot()
    res.json(snapshot)
  })

  app.get('/api/dashboard/worker/status', async (_req, res) => {
    const snapshot = await context.buildDashboardSnapshot()
    const recentPaidCalls = snapshot.agents
      .flatMap((agent) => agent.paidCalls)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 10)

    res.json({
      ok: true,
      baseDir: context.baseDir,
      recentPaidCalls,
      summary: snapshot.summary,
    })
  })

  app.get('/api/dashboard/pusd/readiness', async (req, res) => {
    try {
      const agents = await context.workspace.agentRegistry.list()
      const agentId = readMaybeString(req.query.agentId) ?? agents[0]?.agentId
      const serviceId = readMaybeString(req.query.serviceId)
      const walletName = readMaybeString(req.query.wallet)
      const explicitPayer = readMaybeString(req.query.payer)
      const agent = agentId
        ? await context.workspace.agentRegistry.get(agentId)
        : undefined
      const agentWallet = agent?.walletId
        ? await context.workspace.walletRegistry.get(agent.walletId)
        : undefined
      const registeredService = serviceId
        ? await context.workspace.serviceRegistry.get(serviceId)
        : undefined
      const serviceCatalog = serviceId
        ? await context.buildPalmosServiceCatalog()
        : undefined
      const catalogService = serviceId ? serviceCatalog?.[serviceId] : undefined
      if (serviceId && !catalogService) {
        res.status(404).json({
          ok: false,
          error: `Service ${serviceId} was not found or is disabled.`,
          agentId,
          serviceId,
        })
        return
      }
      const resolvedWalletName =
        walletName ?? agent?.owsWalletName ?? context.env.PALMOS_READINESS_OWS_WALLET
      const payer =
        explicitPayer ??
        (resolvedWalletName &&
          context.owsClient?.getSolanaAddress(resolvedWalletName)) ??
        agentWallet?.address?.trim() ??
        undefined
      const recipient =
        readMaybeString(req.query.recipient) ??
        registeredService?.destinationAddress?.trim() ??
        (!serviceId ? context.env.PUSD_MERCHANT_WALLET?.trim() : undefined) ??
        context.localServer?.payToAddress
      const amount =
        readMaybeString(req.query.amount) ??
        catalogService?.expectedAmount ??
        context.env.PUSD_READINESS_AMOUNT?.trim() ??
        '0.01'
      const mint =
        readMaybeString(req.query.mint) ?? readPusdMintFromEnv(context.env)
      const rpcUrl =
        readMaybeString(req.query.rpcUrl) ?? readSolanaRpcUrlFromEnv(context.env)

      if (!payer) {
        res.json({
          ok: false,
          error:
            'Missing payer. Provide ?payer=..., ?wallet=..., or select an agent with a configured wallet.',
          agentId,
          serviceId,
          walletName: resolvedWalletName,
        })
        return
      }

      if (!recipient) {
        res.json({
          ok: false,
          error: serviceId
            ? 'Missing service recipient. Register the service with a destinationAddress or provide ?recipient=... for this readiness check.'
            : 'Missing recipient. Provide ?recipient=... or set PUSD_MERCHANT_WALLET for development checks.',
          agentId,
          serviceId,
          walletName: resolvedWalletName,
        })
        return
      }

      const report = await checkPusdPaymentReadiness({
        payer,
        recipient,
        amount,
        mint,
        rpcUrl,
        env: context.env,
      })
      const now = new Date().toISOString()
      await context.pusdReadinessReports.put({
        reportId: `pusd_readiness_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        createdAt: now,
        updatedAt: now,
        agentId,
        serviceId,
        walletName: resolvedWalletName,
        ok: report.ok,
        report,
      })

      res.json({
        ok: report.ok,
        agentId,
        serviceId,
        walletName: resolvedWalletName,
        report,
      })
    } catch (error) {
      res.json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to complete PUSD readiness check.',
      })
    }
  })

  app.post('/api/dashboard/showcase/run', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'showcase.run',
    })
    if (!identity) {
      return
    }

    if (!isShowcaseRunEnabled(context.env)) {
      res.status(404).json({
        ok: false,
        error:
          'Showcase scenario runs are disabled. Set PALMOS_ENABLE_SHOWCASE_RUN=1 in a development workspace to enable this destructive demo route.',
      })
      return
    }

    try {
      const result = await runDashboardScenario({
        baseDir: context.baseDir,
        env: context.env,
        workspace: context.workspace,
        palmosClient: context.palmosClient,
        owsClient: context.owsClient,
        xmtpNotifier: context.xmtpNotifier,
        portfolioReader: context.portfolioReader,
        serviceCatalog: await context.buildPalmosServiceCatalog(),
      })
      await recordDashboardAudit({
        context,
        identity,
        action: 'showcase.run',
        target: {
          type: 'showcase',
          id: 'dashboard_scenario',
        },
        summary: 'Ran dashboard showcase scenario.',
        metadata: {
          outcomeCount: Object.keys(result.outcomes).length,
        },
      })

      res.json({
        ok: true,
        outcomes: result.outcomes,
        snapshot: await context.buildDashboardSnapshot(),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to run the live dashboard scenario.',
      })
    }
  })

  app.post('/api/dashboard/approvals/:executionId/:decision', async (req, res) => {
    const executionId = req.params.executionId
    const decision = req.params.decision

    if (decision !== 'approve' && decision !== 'reject') {
      sendDashboardApiError(res, 400, {
        code: 'invalid_request',
        message: 'Unsupported decision. Use approve or reject.',
        details: {
          decision,
        },
      })
      return
    }

    let idempotency:
      | ReturnType<typeof beginDashboardMutationIdempotency>
      | undefined
    try {
      const identity = requireDashboardRole({
        req,
        res,
        context,
        operation: 'approval.decide',
      })
      if (!identity) {
        return
      }

      const comment = readMaybeString(req.body?.comment)
      idempotency = beginDashboardMutationIdempotency({
        req,
        res,
        store: context.mutationIdempotency,
        identity,
        operation: 'approval.decide',
        targetId: executionId,
        fingerprint: {
          method: 'POST',
          route: '/api/dashboard/approvals/:executionId/:decision',
          executionId,
          decision,
          comment,
        },
      })
      if (!idempotency) {
        return
      }

      const approvalDecision = decision === 'approve' ? 'approved' : 'rejected'
      const approverActorId =
        identity?.actorId ||
        context.env.DASHBOARD_APPROVER_ACTOR_ID ||
        'operator:dashboard'
      const approverRole =
        identity?.role ||
        context.env.DASHBOARD_APPROVER_ROLE ||
        'operator'
      const approvalComment =
        comment ||
        (decision === 'approve'
          ? 'Approved from dashboard UI.'
          : 'Rejected from dashboard UI.')
      const nativeActionRequest =
        await context.workspace.actionRequestRegistry?.get(executionId)
      const isNativeAssetTransfer =
        nativeActionRequest?.kind === 'asset.transfer'

      const result = isNativeAssetTransfer
        ? await resolvePendingAssetTransferApproval(
            {
              kernel: context.workspace.kernel,
              agentRegistry: context.workspace.agentRegistry,
              actionRequests: context.workspace.actionRequestRegistry!,
              owsClient: context.owsClient,
            },
            {
              actionRequestId: executionId,
              decision: approvalDecision,
              approverActorId,
              approverRole,
              comment: approvalComment,
            },
          )
        : await resolvePendingPaidCallApproval(
            {
              baseDir: context.baseDir,
              kernel: context.workspace.kernel,
              agentRegistry: context.workspace.agentRegistry,
              paidCalls: context.workspace.paidCallRegistry,
              palmosClient: context.palmosClient,
              owsClient: context.owsClient,
              serviceCatalog: await context.buildPalmosServiceCatalog(),
              xmtpNotifier: context.xmtpNotifier,
              env: context.env,
            },
            {
              executionId,
              decision: approvalDecision,
              approverActorId,
              approverRole,
              comment: approvalComment,
            },
          )

      if (result.kind === 'execution_failed') {
        context.operationalMetrics.increment('approval.execution_failures')
      }
      const snapshot = await context.buildDashboardSnapshot()
      await recordDashboardAudit({
        context,
        identity,
        action: 'approval.decide',
        target: {
          type: isNativeAssetTransfer ? 'action_request' : 'paid_call',
          id: executionId,
        },
        summary: `${decision === 'approve' ? 'Approved' : 'Rejected'} ${
          isNativeAssetTransfer ? 'asset transfer action request' : 'paid call'
        } ${executionId}.`,
        metadata: {
          decision,
          resultKind: result.kind,
          actionRequestKind: isNativeAssetTransfer
            ? nativeActionRequest?.kind
            : undefined,
        },
      })

      const responseBody = {
        ok: true,
        result,
        snapshot,
      }
      completeDashboardMutationIdempotency(context.mutationIdempotency, idempotency, {
        statusCode: 200,
        body: responseBody,
      })
      res.json(responseBody)
    } catch (error) {
      failDashboardMutationIdempotency(context.mutationIdempotency, idempotency)
      const identity = readDashboardAccessIdentity({ req, env: context.env })
      if (identity && isApprovalConflictError(error)) {
        await recordDashboardAudit({
          context,
          identity,
          action: 'approval.decide',
          status: 'failed',
          target: {
            type:
              (await context.workspace.actionRequestRegistry?.get(executionId))
                ?.kind === 'asset.transfer'
                ? 'action_request'
                : 'paid_call',
            id: executionId,
          },
          summary: `Ignored duplicate approval decision for ${executionId}.`,
          metadata: {
            decision,
            errorCode: error.code,
            currentStatus: error.currentStatus,
          },
        })
        sendDashboardApiError(res, 409, {
          code: error.code,
          message:
            'This approval is already being reviewed or has already been resolved.',
          details: {
            executionId,
            currentStatus: error.currentStatus,
          },
        })
        return
      }
      sendDashboardInternalError(res, 'Approval request failed.')
    }
  })
}
