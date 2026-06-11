import type express from 'express'
import type {
  ActionRequestKind,
  ActionRequestStatus,
} from '../../../store/ActionRequestRegistry.js'
import {
  DASHBOARD_ACTION_REQUEST_KINDS,
  DASHBOARD_ACTION_REQUEST_STATUSES,
} from '../actionRequestHistory.js'
import { requireDashboardRole } from '../access.js'
import {
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import type { DashboardRouteContext } from '../context.js'
import { readMaybeString } from '../shared.js'
import { buildDashboardWalletActionHistory } from '../walletActions.js'
import { buildDashboardWalletActionDetail } from '../walletActionDetail.js'

const DEFAULT_WALLET_ACTION_LIMIT = 20
const MAX_WALLET_ACTION_LIMIT = 100

function readQueryValue(value: unknown): string | undefined {
  return readMaybeString(Array.isArray(value) ? value[0] : value)
}

function readWalletActionLimit(value: unknown): number | undefined {
  const raw = readQueryValue(value)
  if (!raw) {
    return DEFAULT_WALLET_ACTION_LIMIT
  }

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) &&
    parsed >= 1 &&
    parsed <= MAX_WALLET_ACTION_LIMIT
    ? parsed
    : undefined
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

export function registerWalletActionRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.get('/api/dashboard/wallet-actions/:walletActionId', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner', 'operator'],
      operation: 'wallet_action.detail.read',
    })
    if (!identity) {
      return
    }

    const walletActionId = readMaybeString(req.params.walletActionId)
    if (!walletActionId) {
      sendDashboardApiError(res, 400, {
        code: 'invalid_request',
        message: 'Missing wallet action id.',
      })
      return
    }

    try {
      const detail = await buildDashboardWalletActionDetail({
        workspace: context.workspace,
        walletActionId,
      })

      if (!detail) {
        sendDashboardApiError(res, 404, {
          code: 'not_found',
          message: `Wallet action ${walletActionId} was not found.`,
          details: {
            walletActionId,
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
          : 'Unable to read wallet action detail.',
      )
    }
  })

  app.get('/api/dashboard/wallet-actions', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner', 'operator'],
      operation: 'wallet_action.history.read',
    })
    if (!identity) {
      return
    }

    const limit = readWalletActionLimit(req.query.limit)
    const kind = readEnumQueryValue<ActionRequestKind>(
      req.query.kind,
      DASHBOARD_ACTION_REQUEST_KINDS,
    )
    const status = readEnumQueryValue<ActionRequestStatus>(
      req.query.status,
      DASHBOARD_ACTION_REQUEST_STATUSES,
    )
    if (!limit || kind === null || status === null) {
      sendDashboardApiError(res, 400, {
        code: 'invalid_request',
        message: 'Invalid wallet action history query.',
      })
      return
    }

    try {
      const history = await buildDashboardWalletActionHistory({
        workspace: context.workspace,
        query: {
          agentId: readQueryValue(req.query.agentId),
          walletId: readQueryValue(req.query.walletId),
          kind,
          status,
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
          : 'Unable to read wallet action history.',
      )
    }
  })
}
