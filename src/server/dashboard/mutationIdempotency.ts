import { createHash } from 'crypto'
import type express from 'express'
import type { DashboardAccessIdentity } from './access.js'
import { sendDashboardApiError } from './apiErrors.js'
import { normalizeSdkIdempotencyKey } from './sdkIdempotency.js'
import { readMaybeString } from './shared.js'

export type DashboardMutationIdempotencyResponse = {
  statusCode: number
  body: unknown
}

type DashboardMutationIdempotencyRecord =
  | {
      status: 'in_flight'
      fingerprint: string
      expiresAt: number
    }
  | {
      status: 'completed'
      fingerprint: string
      expiresAt: number
      response: DashboardMutationIdempotencyResponse
    }

export type DashboardMutationIdempotencyStore = {
  reserve(input: {
    actorId: string
    operation: string
    targetId: string
    idempotencyKey: string
    fingerprint: string
  }):
    | { kind: 'reserved'; cacheKey: string }
    | { kind: 'replay'; response: DashboardMutationIdempotencyResponse }
    | { kind: 'conflict'; reason: 'in_flight' | 'fingerprint_mismatch' }
  complete(
    reservation: { cacheKey: string },
    response: DashboardMutationIdempotencyResponse,
  ): void
  fail(reservation: { cacheKey: string }): void
}

export type DashboardMutationIdempotencyReservation =
  | { kind: 'skipped' }
  | { kind: 'reserved'; cacheKey: string }

const DEFAULT_TTL_MS = 10 * 60 * 1000
const DEFAULT_MAX_ENTRIES = 2_000

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

function hashFingerprint(input: unknown): string {
  return createHash('sha256').update(stableJson(input)).digest('base64url')
}

export function createDashboardMutationFingerprint(input: unknown): string {
  return hashFingerprint(input)
}

export function readDashboardIdempotencyKey(
  req: express.Request,
): string | undefined {
  return (
    normalizeSdkIdempotencyKey(readFirstHeader(req.headers['idempotency-key'])) ??
    normalizeSdkIdempotencyKey(readFirstHeader(req.headers['x-idempotency-key'])) ??
    normalizeSdkIdempotencyKey(readMaybeString(req.body?.idempotencyKey))
  )
}

export function createDashboardMutationIdempotencyStore(input?: {
  ttlMs?: number
  maxEntries?: number
}): DashboardMutationIdempotencyStore {
  const ttlMs = input?.ttlMs ?? DEFAULT_TTL_MS
  const maxEntries = input?.maxEntries ?? DEFAULT_MAX_ENTRIES
  const records = new Map<string, DashboardMutationIdempotencyRecord>()

  function now(): number {
    return Date.now()
  }

  function pruneExpired(at: number): void {
    for (const [key, record] of records) {
      if (record.expiresAt <= at) {
        records.delete(key)
      }
    }
  }

  function pruneOldest(): void {
    while (records.size > maxEntries) {
      const oldest = records.keys().next().value as string | undefined
      if (!oldest) {
        return
      }
      records.delete(oldest)
    }
  }

  function buildCacheKey(input: {
    actorId: string
    operation: string
    targetId: string
    idempotencyKey: string
  }): string {
    return hashFingerprint({
      actorId: input.actorId,
      operation: input.operation,
      targetId: input.targetId,
      idempotencyKey: input.idempotencyKey,
    })
  }

  return {
    reserve(input) {
      const at = now()
      pruneExpired(at)
      const cacheKey = buildCacheKey(input)
      const existing = records.get(cacheKey)
      if (existing) {
        records.delete(cacheKey)
        records.set(cacheKey, existing)

        if (existing.fingerprint !== input.fingerprint) {
          return { kind: 'conflict', reason: 'fingerprint_mismatch' }
        }

        if (existing.status === 'in_flight') {
          return { kind: 'conflict', reason: 'in_flight' }
        }

        return { kind: 'replay', response: existing.response }
      }

      records.set(cacheKey, {
        status: 'in_flight',
        fingerprint: input.fingerprint,
        expiresAt: at + ttlMs,
      })
      pruneOldest()
      return { kind: 'reserved', cacheKey }
    },
    complete(reservation, response) {
      const existing = records.get(reservation.cacheKey)
      if (!existing) {
        return
      }
      records.set(reservation.cacheKey, {
        status: 'completed',
        fingerprint: existing.fingerprint,
        expiresAt: now() + ttlMs,
        response,
      })
      pruneOldest()
    },
    fail(reservation) {
      records.delete(reservation.cacheKey)
    },
  }
}

export function beginDashboardMutationIdempotency(input: {
  req: express.Request
  res: express.Response
  store?: DashboardMutationIdempotencyStore
  identity: DashboardAccessIdentity
  operation: string
  targetId: string
  fingerprint: unknown
}): DashboardMutationIdempotencyReservation | undefined {
  const idempotencyKey = readDashboardIdempotencyKey(input.req)
  if (!idempotencyKey || !input.store) {
    return { kind: 'skipped' }
  }

  const result = input.store.reserve({
    actorId: input.identity.actorId,
    operation: input.operation,
    targetId: input.targetId,
    idempotencyKey,
    fingerprint: createDashboardMutationFingerprint(input.fingerprint),
  })

  if (result.kind === 'reserved') {
    return result
  }

  if (result.kind === 'replay') {
    input.res.setHeader('Idempotency-Replayed', 'true')
    input.res.status(result.response.statusCode).json(result.response.body)
    return undefined
  }

  sendDashboardApiError(input.res, 409, {
    code: 'idempotency_conflict',
    message:
      result.reason === 'in_flight'
        ? 'A matching dashboard mutation is already in progress.'
        : 'Idempotency key was already used for a different dashboard mutation.',
    details: {
      operation: input.operation,
      targetId: input.targetId,
      reason: result.reason,
    },
  })
  return undefined
}

export function completeDashboardMutationIdempotency(
  store: DashboardMutationIdempotencyStore | undefined,
  reservation: DashboardMutationIdempotencyReservation,
  response: DashboardMutationIdempotencyResponse,
): void {
  if (reservation.kind === 'reserved') {
    store?.complete(reservation, response)
  }
}

export function failDashboardMutationIdempotency(
  store: DashboardMutationIdempotencyStore | undefined,
  reservation: DashboardMutationIdempotencyReservation | undefined,
): void {
  if (reservation?.kind === 'reserved') {
    store?.fail(reservation)
  }
}
