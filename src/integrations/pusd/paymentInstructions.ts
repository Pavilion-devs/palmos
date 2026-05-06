import {
  PALMOS_PAYMENT_RAIL,
  PUSD_SYMBOL,
  readPusdMintFromEnv,
  readPusdNetworkFromEnv,
  type SolanaCluster,
} from './constants.js'

export type PusdPaymentRequestStatus =
  | 'created'
  | 'paid'
  | 'expired'
  | 'failed'

export type PusdPaymentRequest = {
  id: string
  createdAt: string
  updatedAt: string
  expiresAt: string
  status: PusdPaymentRequestStatus
  amount: string
  recipient: string
  reference: string
  network: SolanaCluster
  mint: string
  description?: string
  serviceId?: string
  vendorId?: string
  transactionSignature?: string
}

export type PusdPaymentRequiredResponse = {
  error: 'payment_required'
  paymentRail: typeof PALMOS_PAYMENT_RAIL
  amount: string
  currency: typeof PUSD_SYMBOL
  mint: string
  recipient: string
  reference: string
  expiresAt: string
  network: SolanaCluster
  description?: string
}

export type CreatePusdPaymentRequestInput = {
  amount: string
  recipient: string
  description?: string
  serviceId?: string
  vendorId?: string
  ttlSeconds?: number
  now?: () => Date
  createId?: (prefix: string) => string
  env?: Record<string, string | undefined>
}

function defaultCreateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function createPusdPaymentRequest(
  input: CreatePusdPaymentRequestInput,
): PusdPaymentRequest {
  const now = input.now?.() ?? new Date()
  const ttlSeconds = input.ttlSeconds ?? 300
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString()
  const id = input.createId?.('pusd_pay_req') ?? defaultCreateId('pusd_pay_req')

  return {
    id,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt,
    status: 'created',
    amount: input.amount,
    recipient: input.recipient,
    reference: id,
    network: readPusdNetworkFromEnv(input.env),
    mint: readPusdMintFromEnv(input.env),
    description: input.description,
    serviceId: input.serviceId,
    vendorId: input.vendorId,
  }
}

export function toPusdPaymentRequiredResponse(
  request: PusdPaymentRequest,
): PusdPaymentRequiredResponse {
  return {
    error: 'payment_required',
    paymentRail: PALMOS_PAYMENT_RAIL,
    amount: request.amount,
    currency: PUSD_SYMBOL,
    mint: request.mint,
    recipient: request.recipient,
    reference: request.reference,
    expiresAt: request.expiresAt,
    network: request.network,
    description: request.description,
  }
}

export function isPusdPaymentRequestExpired(
  request: PusdPaymentRequest,
  now: Date = new Date(),
): boolean {
  return new Date(request.expiresAt).getTime() <= now.getTime()
}
