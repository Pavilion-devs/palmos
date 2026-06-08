import { PublicKey } from '@solana/web3.js'
import {
  formatPusdBaseUnits,
  parsePusdAmountToBaseUnits,
} from '../../integrations/pusd/amount.js'
import {
  PALMOS_PAYMENT_RAIL,
  PUSD_SYMBOL,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_LOCAL_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
} from '../../integrations/pusd/constants.js'
import type { PalmosPaidServiceDefinition } from '../../integrations/pusd/serviceCatalog.js'
import type { RegisteredPalmosServiceRecord } from '../../store/PalmosServiceRegistry.js'
import {
  validateRegisteredServiceEndpoint,
  type EndpointLookup,
} from './serviceEndpointSafety.js'

export type ServiceReadinessFailureCode =
  | 'service.disabled'
  | 'service.unverified'
  | 'service.unsupported_payment_rail'
  | 'service.unsupported_asset'
  | 'service.unsupported_chain'
  | 'service.invalid_expected_amount'
  | 'service.amount_mismatch'
  | 'service.invalid_recipient'
  | 'service.unsafe_endpoint'

export type ServiceReadinessCheck = {
  code: ServiceReadinessFailureCode
  message: string
}

export type ServiceReadinessResult =
  | {
      ok: true
      checks: []
    }
  | {
      ok: false
      checks: ServiceReadinessCheck[]
    }

function normalizePositiveAmount(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined
  }

  try {
    const parsed = parsePusdAmountToBaseUnits(value)
    return parsed > 0n ? formatPusdBaseUnits(parsed) : undefined
  } catch {
    return undefined
  }
}

function isValidSolanaAddress(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false
  }

  try {
    new PublicKey(value.trim())
    return true
  } catch {
    return false
  }
}

function isSupportedSolanaChain(chainId: string): boolean {
  return (
    chainId === SOLANA_MAINNET_CHAIN_ID ||
    chainId === SOLANA_DEVNET_CHAIN_ID ||
    chainId === SOLANA_LOCAL_CHAIN_ID
  )
}

export async function evaluatePalmosServiceReadiness(input: {
  service: PalmosPaidServiceDefinition<unknown>
  registeredService?: RegisteredPalmosServiceRecord
  destinationAddress?: string
  endpointUrl?: string
  requestedAmount?: string
  requireVerified?: boolean
  requireSafeEndpoint?: boolean
  allowedHostnames?: string[]
  lookup?: EndpointLookup
}): Promise<ServiceReadinessResult> {
  const checks: ServiceReadinessCheck[] = []

  if (input.registeredService?.status === 'disabled') {
    checks.push({
      code: 'service.disabled',
      message: `Registered service ${input.service.serviceId} is disabled.`,
    })
  }

  if (input.service.paymentRail !== PALMOS_PAYMENT_RAIL) {
    checks.push({
      code: 'service.unsupported_payment_rail',
      message: `Service ${input.service.serviceId} does not use the PalmOS PUSD rail.`,
    })
  }

  if (input.service.assetSymbol !== PUSD_SYMBOL) {
    checks.push({
      code: 'service.unsupported_asset',
      message: `Service ${input.service.serviceId} does not charge PUSD.`,
    })
  }

  if (!isSupportedSolanaChain(input.service.chainId)) {
    checks.push({
      code: 'service.unsupported_chain',
      message: `Service ${input.service.serviceId} uses unsupported chain ${input.service.chainId}.`,
    })
  }

  const expectedAmount = normalizePositiveAmount(input.service.expectedAmount)
  if (!expectedAmount) {
    checks.push({
      code: 'service.invalid_expected_amount',
      message: `Service ${input.service.serviceId} has an invalid expected amount.`,
    })
  }

  const requestedAmount = normalizePositiveAmount(input.requestedAmount)
  if (input.requestedAmount && (!requestedAmount || requestedAmount !== expectedAmount)) {
    checks.push({
      code: 'service.amount_mismatch',
      message: `Requested amount does not match service ${input.service.serviceId} expected amount.`,
    })
  }

  if (!isValidSolanaAddress(input.destinationAddress)) {
    checks.push({
      code: 'service.invalid_recipient',
      message: `Service ${input.service.serviceId} does not have a valid Solana recipient wallet.`,
    })
  }

  const verificationStatus =
    input.registeredService?.verificationStatus ??
    input.service.verificationStatus ??
    'unchecked'
  const needsVerification =
    input.requireVerified ||
    (input.registeredService != null && input.requireSafeEndpoint === true)
  if (needsVerification && verificationStatus !== 'verified') {
    checks.push({
      code: 'service.unverified',
      message: `Registered service ${input.service.serviceId} is not verified.`,
    })
  }

  if (
    input.requireSafeEndpoint &&
    verificationStatus === 'verified' &&
    input.endpointUrl
  ) {
    const endpointSafety = await validateRegisteredServiceEndpoint({
      endpointUrl: input.endpointUrl,
      lookup: input.lookup,
      allowedHostnames: input.allowedHostnames,
    })
    if (!endpointSafety.ok) {
      checks.push({
        code: 'service.unsafe_endpoint',
        message: `Service ${input.service.serviceId} endpoint is unsafe: ${endpointSafety.reason}.`,
      })
    }
  }

  if (checks.length > 0) {
    return {
      ok: false,
      checks,
    }
  }

  return {
    ok: true,
    checks: [],
  }
}

export function formatServiceReadinessFailure(
  result: ServiceReadinessResult,
): string {
  if (result.ok) {
    return 'Service is ready.'
  }

  return result.checks.map((check) => `${check.code}: ${check.message}`).join('\n')
}
