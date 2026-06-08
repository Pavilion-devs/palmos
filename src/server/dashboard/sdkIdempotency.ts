import { createHash } from 'crypto'
import type express from 'express'
import type { ActionRequestRecord } from '../../store/ActionRequestRegistry.js'
import type { AgentRecord } from '../../store/AgentRegistry.js'
import type { PaidCallRecord } from '../../store/PaidCallRegistry.js'
import { readMaybeString } from './shared.js'

const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9._:-]{8,160}$/

function readFirstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }

  if (!value || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`
}

export function normalizeSdkIdempotencyKey(value: unknown): string | undefined {
  const key = readMaybeString(value)
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return undefined
  }

  return key
}

export function readSdkIdempotencyKey(req: express.Request): string | undefined {
  return (
    normalizeSdkIdempotencyKey(readFirstHeader(req.headers['idempotency-key'])) ??
    normalizeSdkIdempotencyKey(readFirstHeader(req.headers['x-idempotency-key'])) ??
    normalizeSdkIdempotencyKey(req.body?.idempotencyKey)
  )
}

export function createSdkIdempotentExecutionId(input: {
  agentId: string
  idempotencyKey: string
}): string {
  const digest = createHash('sha256')
    .update(`${input.agentId}:${input.idempotencyKey}`)
    .digest('base64url')
    .slice(0, 32)
  return `paid_call_idem_${digest}`
}

export function createSdkIdempotentActionRequestId(input: {
  agentId: string
  idempotencyKey: string
}): string {
  const digest = createHash('sha256')
    .update(`${input.agentId}:asset.transfer:${input.idempotencyKey}`)
    .digest('base64url')
    .slice(0, 32)
  return `action_request_idem_${digest}`
}

export function isSameSdkIdempotentPayRequest(input: {
  execution: PaidCallRecord
  serviceId: string
  amount: string
  request: Record<string, unknown>
}): boolean {
  return (
    input.execution.serviceId === input.serviceId &&
    input.execution.amount === input.amount &&
    stableJson(input.execution.requestPayload) === stableJson(input.request)
  )
}

export function isSameSdkIdempotentTransferRequest(input: {
  actionRequest: ActionRequestRecord
  destinationAddress: string
  chainId: string
  assetSymbol: string
  amount: string
  counterpartyId?: string
  note?: string
}): boolean {
  const payload = input.actionRequest.requestPayload
  const originalCounterpartyId =
    typeof payload.counterpartyId === 'string'
      ? payload.counterpartyId
      : undefined
  return (
    input.actionRequest.kind === 'asset.transfer' &&
    input.actionRequest.target.kind === 'address' &&
    input.actionRequest.target.address === input.destinationAddress &&
    input.actionRequest.target.chainId === input.chainId &&
    input.actionRequest.value?.assetSymbol === input.assetSymbol &&
    input.actionRequest.value.amount === input.amount &&
    originalCounterpartyId === input.counterpartyId &&
    (typeof payload.note === 'string' ? payload.note : undefined) === input.note
  )
}

export function existingActionRequestToSdkResult(input: {
  agent: AgentRecord
  actionRequest: ActionRequestRecord
}) {
  const { agent, actionRequest } = input

  if (actionRequest.status === 'blocked') {
    return {
      kind: 'blocked',
      agent,
      actionRequest,
      reason: actionRequest.errorMessage ?? 'Action request was blocked.',
    }
  }

  if (actionRequest.status === 'approval_pending') {
    return {
      kind: 'approval_pending',
      agent,
      actionRequest,
      turnOutput: [],
    }
  }

  if (
    actionRequest.status === 'waiting_for_execution' ||
    actionRequest.status === 'executing' ||
    actionRequest.status === 'policy_checked' ||
    actionRequest.status === 'approved'
  ) {
    return {
      kind: 'waiting_for_execution',
      agent,
      actionRequest,
      turnOutput: [],
    }
  }

  if (actionRequest.status === 'failed') {
    return {
      kind: 'execution_failed',
      agent,
      actionRequest,
      turnOutput: [],
      error: actionRequest.errorMessage ?? 'Action request execution failed.',
    }
  }

  if (actionRequest.status === 'created') {
    return {
      kind: 'waiting_for_execution',
      agent,
      actionRequest,
      turnOutput: [],
    }
  }

  return {
    kind: 'executed',
    agent,
    actionRequest,
    turnOutput: [],
  }
}

export function existingPaidCallToSdkResult(input: {
  agent: AgentRecord
  execution: PaidCallRecord
}) {
  const { agent, execution } = input

  if (execution.status === 'blocked') {
    return {
      kind: 'blocked',
      agent,
      execution,
      reason: execution.errorMessage ?? 'Paid call was blocked.',
    }
  }

  if (execution.status === 'approval_pending') {
    return {
      kind: 'approval_pending',
      agent,
      execution,
      turnOutput: [],
    }
  }

  if (execution.status === 'waiting_for_execution') {
    return {
      kind: 'waiting_for_execution',
      agent,
      execution,
      turnOutput: [],
    }
  }

  if (execution.status === 'failed') {
    return {
      kind: 'execution_failed',
      agent,
      execution,
      turnOutput: [],
      error: execution.errorMessage ?? 'Paid call execution failed.',
    }
  }

  return {
    kind: 'executed',
    agent,
    execution,
    turnOutput: [],
  }
}
