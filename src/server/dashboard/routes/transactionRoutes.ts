import type express from 'express'
import { requireDashboardRole } from '../access.js'
import {
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import type { DashboardRouteContext } from '../context.js'
import {
  buildDashboardTransactions,
  DASHBOARD_TRANSACTION_KINDS,
  type DashboardTransactionKind,
} from '../dashboardTransactions.js'
import { readMaybeString } from '../shared.js'

const DEFAULT_TRANSACTION_LIMIT = 20
const MAX_TRANSACTION_LIMIT = 100

function readQueryValue(value: unknown): string | undefined {
  return readMaybeString(Array.isArray(value) ? value[0] : value)
}

function readTransactionLimit(value: unknown): number | undefined {
  const raw = readQueryValue(value)
  if (!raw) {
    return DEFAULT_TRANSACTION_LIMIT
  }

  const parsed = Number.parseInt(raw, 10)
  if (
    !Number.isFinite(parsed) ||
    parsed < 1 ||
    parsed > MAX_TRANSACTION_LIMIT
  ) {
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

export function registerTransactionRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.get('/api/dashboard/transactions', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      roles: ['owner', 'operator', 'judge'],
      operation: 'transaction.history.read',
    })
    if (!identity) {
      return
    }

    const limit = readTransactionLimit(req.query.limit)
    if (limit == null) {
      sendDashboardApiError(res, 400, {
        code: 'invalid_request',
        message: `limit must be an integer between 1 and ${MAX_TRANSACTION_LIMIT}.`,
        details: {
          limit: readQueryValue(req.query.limit),
          max: MAX_TRANSACTION_LIMIT,
        },
      })
      return
    }

    const transactionKind = readEnumQueryValue<DashboardTransactionKind>(
      req.query.transactionKind,
      DASHBOARD_TRANSACTION_KINDS,
    )
    if (transactionKind === null) {
      sendDashboardApiError(res, 400, {
        code: 'invalid_request',
        message: 'Unsupported transaction kind filter.',
        details: {
          transactionKind: readQueryValue(req.query.transactionKind),
          allowed: [...DASHBOARD_TRANSACTION_KINDS],
        },
      })
      return
    }

    try {
      const result = await buildDashboardTransactions({
        workspace: context.workspace,
        query: {
          agentId: readQueryValue(req.query.agentId),
          walletId: readQueryValue(req.query.walletId),
          transactionKind: transactionKind ?? undefined,
          limit,
        },
      })

      res.json({
        ok: true,
        projectionMode: result.projectionMode,
        summary: result.summary,
        transactions: result.transactions,
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
          : 'Unable to read dashboard transactions.',
      )
    }
  })
}
