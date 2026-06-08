import type express from 'express'
import type { RegisteredPalmosServiceRecord } from '../../../store/PalmosServiceRegistry.js'
import { requireDashboardRole } from '../access.js'
import {
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import { recordDashboardAudit } from '../audit.js'
import type { DashboardRouteContext } from '../context.js'
import { sanitizeService, stripAgentSecrets } from '../sanitizers.js'
import { readMaybeString } from '../shared.js'
import { readRegisteredServiceInput } from '../serviceInput.js'
import {
  setRegisteredPalmosServiceStatus,
  verifyRegisteredPalmosServiceRecord,
} from '../serviceLifecycle.js'
import {
  evaluatePalmosServiceReadiness,
  formatServiceReadinessFailure,
} from '../serviceReadiness.js'
import { readServiceEndpointAllowlist } from '../serviceEndpointSafety.js'

export function registerServiceRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.get('/api/dashboard/services', async (_req, res) => {
    const catalog = await context.buildPalmosServiceCatalog()
    const registeredServices = await context.workspace.serviceRegistry.list()
    const registeredById = new Map(
      registeredServices.map((service) => [service.serviceId, service]),
    )

    res.json({
      ok: true,
      services: Object.values(catalog)
        .filter((service) => service.visible !== false)
        .map((service) => {
          const registered = registeredById.get(service.serviceId)
          return {
            serviceId: service.serviceId,
            label: service.label,
            vendorId: service.vendorId,
            chainId: service.chainId,
            assetSymbol: service.assetSymbol,
            expectedAmount: service.expectedAmount,
            paymentRail: service.paymentRail,
            source: registered ? 'registered' : 'built_in',
            registered: registered ? sanitizeService(registered) : undefined,
          }
        }),
    })
  })

  app.post('/api/dashboard/services', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'service.register',
    })
    if (!identity) {
      return
    }

    try {
      const input = await readRegisteredServiceInput(req.body, context.env)
      if (!input) {
        sendDashboardApiError(res, 400, {
          code: 'invalid_request',
          message:
            'Missing service fields. Provide serviceId, endpointUrl, destinationAddress, and expectedAmount.',
        })
        return
      }

      const existing = await context.workspace.serviceRegistry.get(input.serviceId)
      const at = new Date().toISOString()
      const record: RegisteredPalmosServiceRecord = {
        ...input,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
        status: existing?.status ?? 'active',
        verifiedAt: input.verificationStatus === 'verified' ? at : undefined,
      }
      const saved = existing
        ? await context.workspace.serviceRegistry.putIfUpdatedAt(
            record,
            existing.updatedAt,
          )
        : (await context.workspace.serviceRegistry.put(record), true)
      if (!saved) {
        const current = await context.workspace.serviceRegistry.get(input.serviceId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'service.register',
          target: {
            type: 'service',
            id: input.serviceId,
          },
          summary: `Service ${input.serviceId} changed while registration update was in progress.`,
          metadata: {
            expectedUpdatedAt: existing?.updatedAt,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
            errorCode: 'service_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'service_conflict',
          message: 'Service changed while the registration update was in progress.',
          details: {
            serviceId: input.serviceId,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
          },
        })
        return
      }
      await recordDashboardAudit({
        context,
        identity,
        action: 'service.register',
        target: {
          type: 'service',
          id: record.serviceId,
        },
        summary: `${existing ? 'Updated' : 'Registered'} service ${record.serviceId}.`,
        metadata: {
          vendorId: record.vendorId,
          method: record.method,
          requestMode: record.requestMode,
          expectedAmount: record.expectedAmount,
          status: record.status,
        },
      })

      res.json({
        ok: true,
        service: sanitizeService(record),
      })
    } catch (error) {
      sendDashboardInternalError(res, 'Unable to register PalmOS service.')
    }
  })

  app.post('/api/dashboard/services/:serviceId/verify', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'service.verify',
    })
    if (!identity) {
      return
    }

    try {
      const serviceId = readMaybeString(req.params.serviceId)
      if (!serviceId) {
        res.status(400).json({
          ok: false,
          error: 'Missing service id.',
        })
        return
      }

      const existing = await context.workspace.serviceRegistry.get(serviceId)
      if (!existing) {
        res.status(404).json({
          ok: false,
          error: `Service ${serviceId} was not found.`,
        })
        return
      }

      const result = await verifyRegisteredPalmosServiceRecord({
        record: existing,
        allowedHostnames: readServiceEndpointAllowlist(context.env),
      })
      const saved = await context.workspace.serviceRegistry.putIfUpdatedAt(
        result.record,
        existing.updatedAt,
      )
      if (!saved) {
        const current = await context.workspace.serviceRegistry.get(serviceId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'service.verify',
          target: {
            type: 'service',
            id: existing.serviceId,
          },
          summary: `Service ${existing.serviceId} changed while verification was in progress.`,
          metadata: {
            expectedUpdatedAt: existing.updatedAt,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
            errorCode: 'service_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'service_conflict',
          message: 'Service changed while verification was in progress.',
          details: {
            serviceId,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
          },
        })
        return
      }
      await recordDashboardAudit({
        context,
        identity,
        action: 'service.verify',
        target: {
          type: 'service',
          id: result.record.serviceId,
        },
        summary: result.readiness.ok
          ? `Verified service ${result.record.serviceId}.`
          : `Service ${result.record.serviceId} verification failed.`,
        metadata: {
          verificationStatus: result.record.verificationStatus,
          checks: result.readiness.ok ? [] : result.readiness.checks,
        },
      })

      res.status(result.readiness.ok ? 200 : 400).json({
        ok: result.readiness.ok,
        service: sanitizeService(result.record),
        checks: result.readiness.checks,
        error: result.readiness.ok
          ? undefined
          : formatServiceReadinessFailure(result.readiness),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to verify PalmOS service.',
      })
    }
  })

  app.post('/api/dashboard/services/:serviceId/disable', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'service.disable',
    })
    if (!identity) {
      return
    }

    try {
      const serviceId = readMaybeString(req.params.serviceId)
      if (!serviceId) {
        res.status(400).json({
          ok: false,
          error: 'Missing service id.',
        })
        return
      }

      const existing = await context.workspace.serviceRegistry.get(serviceId)
      if (!existing) {
        res.status(404).json({
          ok: false,
          error: `Service ${serviceId} was not found.`,
        })
        return
      }

      const record = setRegisteredPalmosServiceStatus({
        record: existing,
        status: 'disabled',
      })
      const saved = await context.workspace.serviceRegistry.putIfUpdatedAt(
        record,
        existing.updatedAt,
      )
      if (!saved) {
        const current = await context.workspace.serviceRegistry.get(serviceId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'service.disable',
          target: {
            type: 'service',
            id: existing.serviceId,
          },
          summary: `Service ${existing.serviceId} changed while disable was in progress.`,
          metadata: {
            expectedUpdatedAt: existing.updatedAt,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
            errorCode: 'service_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'service_conflict',
          message: 'Service changed while disable was in progress.',
          details: {
            serviceId,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
          },
        })
        return
      }
      await recordDashboardAudit({
        context,
        identity,
        action: 'service.disable',
        target: {
          type: 'service',
          id: record.serviceId,
        },
        summary: `Disabled service ${record.serviceId}.`,
        metadata: {
          verificationStatus: record.verificationStatus,
        },
      })

      res.json({
        ok: true,
        service: sanitizeService(record),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to disable PalmOS service.',
      })
    }
  })

  app.post('/api/dashboard/services/:serviceId/enable', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'service.enable',
    })
    if (!identity) {
      return
    }

    try {
      const serviceId = readMaybeString(req.params.serviceId)
      if (!serviceId) {
        res.status(400).json({
          ok: false,
          error: 'Missing service id.',
        })
        return
      }

      const existing = await context.workspace.serviceRegistry.get(serviceId)
      if (!existing) {
        res.status(404).json({
          ok: false,
          error: `Service ${serviceId} was not found.`,
        })
        return
      }

      const record = setRegisteredPalmosServiceStatus({
        record: existing,
        status: 'active',
      })
      const saved = await context.workspace.serviceRegistry.putIfUpdatedAt(
        record,
        existing.updatedAt,
      )
      if (!saved) {
        const current = await context.workspace.serviceRegistry.get(serviceId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'service.enable',
          target: {
            type: 'service',
            id: existing.serviceId,
          },
          summary: `Service ${existing.serviceId} changed while enable was in progress.`,
          metadata: {
            expectedUpdatedAt: existing.updatedAt,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
            errorCode: 'service_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'service_conflict',
          message: 'Service changed while enable was in progress.',
          details: {
            serviceId,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
          },
        })
        return
      }
      await recordDashboardAudit({
        context,
        identity,
        action: 'service.enable',
        target: {
          type: 'service',
          id: record.serviceId,
        },
        summary: `Enabled service ${record.serviceId}.`,
        metadata: {
          verificationStatus: record.verificationStatus,
        },
      })

      res.json({
        ok: true,
        service: sanitizeService(record),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to enable PalmOS service.',
      })
    }
  })

  app.post('/api/dashboard/agents/:agentId/services/:serviceId/allow', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'agent.service.allow',
    })
    if (!identity) {
      return
    }

    try {
      const agentId = readMaybeString(req.params.agentId)
      const serviceId = readMaybeString(req.params.serviceId)
      if (!agentId || !serviceId) {
        res.status(400).json({
          ok: false,
          error: 'Missing agent id or service id.',
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

      const catalog = await context.buildPalmosServiceCatalog()
      const service = catalog[serviceId]
      if (!service) {
        res.status(404).json({
          ok: false,
          error: `Service ${serviceId} was not found.`,
        })
        return
      }

      const registeredService = await context.workspace.serviceRegistry.get(serviceId)
      const destinationAddress =
        registeredService?.destinationAddress ??
        context.localServer?.payToAddress ??
        context.env.PUSD_MERCHANT_WALLET?.trim()
      const readiness = await evaluatePalmosServiceReadiness({
        service,
        registeredService,
        destinationAddress,
        endpointUrl: registeredService?.endpointUrl,
        requireVerified: registeredService != null,
        requireSafeEndpoint: registeredService != null,
        allowedHostnames: readServiceEndpointAllowlist(context.env),
      })
      if (!readiness.ok) {
        res.status(400).json({
          ok: false,
          error: formatServiceReadinessFailure(readiness),
          checks: readiness.checks,
        })
        return
      }
      const vendorRule = {
        vendorId: service.vendorId,
        label: service.label,
        destinationAddress: destinationAddress!,
        chainId: service.chainId,
      }
      const nextAllowedVendors = [
        ...agent.policyConfig.allowedVendors.filter(
          (vendor) => vendor.vendorId !== vendorRule.vendorId,
        ),
        vendorRule,
      ]
      const updatedAgent = {
        ...agent,
        updatedAt: new Date().toISOString(),
        policyConfig: {
          ...agent.policyConfig,
          allowedVendors: nextAllowedVendors,
        },
      }
      const saved = await context.workspace.agentRegistry.putIfUpdatedAt(
        updatedAgent,
        agent.updatedAt,
      )
      if (!saved) {
        const current = await context.workspace.agentRegistry.get(agentId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'agent.service.allow',
          target: {
            type: 'agent',
            id: agent.agentId,
          },
          summary: `Agent ${agent.agentId} changed while service allow was in progress.`,
          metadata: {
            serviceId: service.serviceId,
            vendorId: service.vendorId,
            expectedUpdatedAt: agent.updatedAt,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
            errorCode: 'agent_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'agent_conflict',
          message: 'Agent changed while service allow was in progress.',
          details: {
            agentId,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
          },
        })
        return
      }
      await recordDashboardAudit({
        context,
        identity,
        action: 'agent.service.allow',
        target: {
          type: 'agent',
          id: agent.agentId,
        },
        summary: `Allowed service ${service.serviceId} for agent ${agent.agentId}.`,
        metadata: {
          serviceId: service.serviceId,
          vendorId: service.vendorId,
          chainId: service.chainId,
        },
      })

      res.json({
        ok: true,
        agent: stripAgentSecrets(updatedAgent),
        service: {
          serviceId: service.serviceId,
          label: service.label,
          vendorId: service.vendorId,
          chainId: service.chainId,
          assetSymbol: service.assetSymbol,
          expectedAmount: service.expectedAmount,
          paymentRail: service.paymentRail,
        },
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to allow service for agent.',
      })
    }
  })

  app.post('/api/dashboard/agents/:agentId/services/:serviceId/unallow', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'agent.service.unallow',
    })
    if (!identity) {
      return
    }

    try {
      const agentId = readMaybeString(req.params.agentId)
      const serviceId = readMaybeString(req.params.serviceId)
      if (!agentId || !serviceId) {
        res.status(400).json({
          ok: false,
          error: 'Missing agent id or service id.',
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

      const catalog = await context.buildPalmosServiceCatalog()
      const service = catalog[serviceId]
      if (!service) {
        res.status(404).json({
          ok: false,
          error: `Service ${serviceId} was not found.`,
        })
        return
      }

      const updatedAgent = {
        ...agent,
        updatedAt: new Date().toISOString(),
        policyConfig: {
          ...agent.policyConfig,
          allowedVendors: agent.policyConfig.allowedVendors.filter(
            (vendor) => vendor.vendorId !== service.vendorId,
          ),
        },
      }
      const saved = await context.workspace.agentRegistry.putIfUpdatedAt(
        updatedAgent,
        agent.updatedAt,
      )
      if (!saved) {
        const current = await context.workspace.agentRegistry.get(agentId)
        await recordDashboardAudit({
          context,
          identity,
          status: 'failed',
          action: 'agent.service.unallow',
          target: {
            type: 'agent',
            id: agent.agentId,
          },
          summary: `Agent ${agent.agentId} changed while service unallow was in progress.`,
          metadata: {
            serviceId: service.serviceId,
            vendorId: service.vendorId,
            expectedUpdatedAt: agent.updatedAt,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
            errorCode: 'agent_conflict',
          },
        })
        sendDashboardApiError(res, 409, {
          code: 'agent_conflict',
          message: 'Agent changed while service unallow was in progress.',
          details: {
            agentId,
            currentUpdatedAt: current?.updatedAt,
            currentStatus: current?.status,
          },
        })
        return
      }
      await recordDashboardAudit({
        context,
        identity,
        action: 'agent.service.unallow',
        target: {
          type: 'agent',
          id: agent.agentId,
        },
        summary: `Removed service ${service.serviceId} from agent ${agent.agentId}.`,
        metadata: {
          serviceId: service.serviceId,
          vendorId: service.vendorId,
        },
      })

      res.json({
        ok: true,
        agent: stripAgentSecrets(updatedAgent),
        service: {
          serviceId: service.serviceId,
          label: service.label,
          vendorId: service.vendorId,
        },
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to remove service from agent.',
      })
    }
  })
}
