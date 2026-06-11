import type express from 'express'
import type {
  ActionRequestKind,
  ActionRequestSource,
  ActionRequestStatus,
} from '../../../store/ActionRequestRegistry.js'
import {
  DASHBOARD_ACTION_REQUEST_KINDS,
  DASHBOARD_ACTION_REQUEST_SOURCES,
  DASHBOARD_ACTION_REQUEST_STATUSES,
  buildDashboardActionRequestHistory,
} from '../actionRequestHistory.js'
import {
  buildDashboardActionRequestDetail,
} from '../actionRequestDetail.js'
import { requireDashboardRole } from '../access.js'
import {
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import type { DashboardRouteContext } from '../context.js'
import { readMaybeString } from '../shared.js'

const DEFAULT_ACTION_REQUEST_LIMIT = 20
const MAX_ACTION_REQUEST_LIMIT = 100

function readQueryValue(value: unknown): string | undefined {
  return readMaybeString(Array.isArray(value) ? value[0] : value)
}

function readActionRequestLimit(value: unknown): number | undefined {
  const raw = readQueryValue(value)
  if (!raw) {
    return DEFAULT_ACTION_REQUEST_LIMIT
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_ACTION_REQUEST_LIMIT) {
    return undefined
  }

  return parsed
}

function readEnumQueryValue<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): Value | undefined | null {
  const raw = readQueryValue(value)
  if (!raw) {
    return undefined
  }

  return allowed.includes(raw as Value) ? (raw as Value) : null
}

export function registerActionRequestRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.get('/api/dashboard/action-requests/:actionRequestId', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner', 'operator'],
      operation: 'action_request.detail.read',
    })
    if (!identity) {
      return
    }

    const actionRequestId = readMaybeString(req.params.actionRequestId)
    if (!actionRequestId) {
      sendDashboardApiError(res, 400, {
        code: 'invalid_request',
        message: 'Missing action request id.',
      })
      return
    }

    try {
      const detail = await buildDashboardActionRequestDetail({
        workspace: context.workspace,
        actionRequestId,
      })

      if (!detail) {
        sendDashboardApiError(res, 404, {
          code: 'not_found',
          message: `Action request ${actionRequestId} was not found.`,
          details: {
            actionRequestId,
          },
        })
        return
      }

      res.json({
        ok: true,
        ...detail,
      })
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          'ActionRequest registry is not available in this workspace.'
      ) {
        sendDashboardApiError(res, 409, {
          code: 'conflict',
          message: error.message,
        })
        return
      }

      sendDashboardInternalError(
        res,
        error instanceof Error
          ? error.message
          : 'Unable to read action request detail.',
      )
    }
  })

  app.get('/api/dashboard/action-requests', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner', 'operator'],
      operation: 'action_request.history.read',
    })
    if (!identity) {
      return
    }

    const limit = readActionRequestLimit(req.query.limit)
    if (limit == null) {
      sendDashboardApiError(res, 400, {
        code: 'invalid_request',
        message: `limit must be an integer between 1 and ${MAX_ACTION_REQUEST_LIMIT}.`,
        details: {
          limit: readQueryValue(req.query.limit),
          max: MAX_ACTION_REQUEST_LIMIT,
        },
      })
      return
    }

    const status = readEnumQueryValue<ActionRequestStatus>(
      req.query.status,
      DASHBOARD_ACTION_REQUEST_STATUSES,
    )
    if (status === null) {
      sendDashboardApiError(res, 400, {
        code: 'invalid_request',
        message: 'Unsupported action request status filter.',
        details: {
          status: readQueryValue(req.query.status),
          allowed: [...DASHBOARD_ACTION_REQUEST_STATUSES],
        },
      })
      return
    }

    const kind = readEnumQueryValue<ActionRequestKind>(
      req.query.kind,
      DASHBOARD_ACTION_REQUEST_KINDS,
    )
    if (kind === null) {
      sendDashboardApiError(res, 400, {
        code: 'invalid_request',
        message: 'Unsupported action request kind filter.',
        details: {
          kind: readQueryValue(req.query.kind),
          allowed: [...DASHBOARD_ACTION_REQUEST_KINDS],
        },
      })
      return
    }

    const source = readEnumQueryValue<ActionRequestSource>(
      req.query.source,
      DASHBOARD_ACTION_REQUEST_SOURCES,
    )
    if (source === null) {
      sendDashboardApiError(res, 400, {
        code: 'invalid_request',
        message: 'Unsupported action request source filter.',
        details: {
          source: readQueryValue(req.query.source),
          allowed: [...DASHBOARD_ACTION_REQUEST_SOURCES],
        },
      })
      return
    }

    try {
      const history = await buildDashboardActionRequestHistory({
        workspace: context.workspace,
        query: {
          agentId: readQueryValue(req.query.agentId),
          status: status ?? undefined,
          kind: kind ?? undefined,
          source: source ?? undefined,
          limit,
        },
      })

      res.json({
        ok: true,
        ...history,
      })
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          'ActionRequest registry is not available in this workspace.'
      ) {
        sendDashboardApiError(res, 409, {
          code: 'conflict',
          message: error.message,
        })
        return
      }

      sendDashboardInternalError(
        res,
        error instanceof Error
          ? error.message
          : 'Unable to read action request history.',
      )
    }
  })
}
