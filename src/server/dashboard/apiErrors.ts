import type express from 'express'
import { readDashboardRequestId } from './requestTelemetry.js'

export type DashboardApiErrorCode =
  | 'dashboard_access_required'
  | 'dashboard_role_required'
  | 'operator_disabled'
  | 'operator_session_secret_not_configured'
  // SIWS sign-in (docs/operator-auth-plan.md §3)
  | 'invalid_address'
  | 'invalid_verify_request'
  | 'nonce_not_found'
  | 'nonce_expired'
  | 'invalid_signature'
  | 'no_active_session'
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | 'csrf_check_failed'
  | 'agent_conflict'
  | 'approval_conflict'
  | 'credential_conflict'
  | 'idempotency_conflict'
  | 'operator_conflict'
  | 'service_conflict'
  | 'wallet_conflict'
  | 'workspace_conflict'
  | 'policy_denied'
  | 'settlement_failed'
  | 'rate_limit_exceeded'
  | 'request_body_too_large'
  | 'invalid_json_body'
  | 'internal_error'

export type DashboardApiErrorBody = {
  ok: false
  error: DashboardApiErrorCode
  message: string
  requestId?: string
  details?: Record<string, unknown>
}

export function buildDashboardApiError(input: {
  code: DashboardApiErrorCode
  message: string
  requestId?: string
  details?: Record<string, unknown>
}): DashboardApiErrorBody {
  const body: DashboardApiErrorBody = {
    ok: false,
    error: input.code,
    message: input.message,
  }

  if (input.requestId) {
    body.requestId = input.requestId
  }

  if (input.details) {
    body.details = input.details
  }

  return body
}

export function sendDashboardApiError(
  res: express.Response,
  status: number,
  input: {
    code: DashboardApiErrorCode
    message: string
    details?: Record<string, unknown>
  },
): express.Response {
  return res.status(status).json(
    buildDashboardApiError({
      ...input,
      requestId: readDashboardRequestId(res),
    }),
  )
}

export function sendDashboardInternalError(
  res: express.Response,
  fallbackMessage: string,
): express.Response {
  return sendDashboardApiError(res, 500, {
    code: 'internal_error',
    message: fallbackMessage,
  })
}
