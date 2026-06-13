import { PublicKey } from '@solana/web3.js'
import type { WalletTransferPolicyPatch } from '../../app/requestWalletPolicyUpdate.js'
import type { AgentTransferRecipientRule } from '../../policies/compileAgentPolicy.js'
import {
  formatPusdBaseUnits,
  parsePusdAmountToBaseUnits,
} from '../../integrations/pusd/amount.js'
import { SOLANA_MAINNET_CHAIN_ID } from '../../integrations/pusd/constants.js'
import type { RegisteredPalmosServiceRecord } from '../../store/PalmosServiceRegistry.js'
import type { Env } from './shared.js'
import { readMaybeString, readRecord } from './shared.js'
import {
  isEndpointHostnameAllowlisted,
  readServiceEndpointAllowlist,
  validateRegisteredServiceEndpoint,
  type EndpointLookup,
} from './serviceEndpointSafety.js'

export function readOptionalPositiveAmount(value: unknown): string | undefined {
  const raw = readMaybeString(value)
  if (!raw) return undefined

  try {
    const parsed = parsePusdAmountToBaseUnits(raw)
    return parsed > 0n ? formatPusdBaseUnits(parsed) : undefined
  } catch {
    return undefined
  }
}

function readPositiveAmount(value: unknown, fallback: string): string {
  const parsed = readOptionalPositiveAmount(value)
  return parsed ?? fallback
}

function isValidSolanaAddress(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value
  } catch {
    return false
  }
}

function readNormalizedStringList(
  value: unknown,
  normalize: (item: string) => string,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    const normalized = normalize((readMaybeString(item) ?? '').trim())
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function readTransferRecipientList(
  value: unknown,
): AgentTransferRecipientRule[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const seen = new Set<string>()
  const out: AgentTransferRecipientRule[] = []
  for (const item of value) {
    const record = readRecord(item)
    const destinationAddress = readMaybeString(record.destinationAddress)?.trim()
    const chainId = readMaybeString(record.chainId)?.trim()
    if (!destinationAddress || !chainId) {
      continue
    }
    // Solana destinations must be real base58 pubkeys — reject typos rather than
    // silently allowlisting an unspendable address.
    if (chainId.includes('solana') && !isValidSolanaAddress(destinationAddress)) {
      continue
    }
    const dedupeKey = `${chainId}:${destinationAddress}`
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    const label = readMaybeString(record.label)?.trim() || undefined
    const counterpartyId =
      readMaybeString(record.counterpartyId)?.trim() ||
      `addr_${destinationAddress.slice(0, 8).toLowerCase()}`
    out.push({ counterpartyId, label, destinationAddress, chainId })
  }
  return out
}

// Parse the operator-editable transfer rails. A field is only present in the
// returned patch when the caller actually sent that array, so an omitted field
// leaves the existing allowlist untouched (vs. an empty array, which is an
// intentional deny-all lockdown).
export function readTransferPolicyPatch(
  value: unknown,
): WalletTransferPolicyPatch | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const candidate = readRecord(value)
  const patch: WalletTransferPolicyPatch = {}
  const allowedRecipients = readTransferRecipientList(candidate.allowedRecipients)
  if (allowedRecipients !== undefined) {
    patch.allowedRecipients = allowedRecipients
  }
  const allowedAssets = readNormalizedStringList(candidate.allowedAssets, (item) =>
    item.toUpperCase(),
  )
  if (allowedAssets !== undefined) {
    patch.allowedAssets = allowedAssets
  }
  const allowedChains = readNormalizedStringList(
    candidate.allowedChains,
    (item) => item,
  )
  if (allowedChains !== undefined) {
    patch.allowedChains = allowedChains
  }
  return Object.keys(patch).length > 0 ? patch : undefined
}

export function readAgentPolicyPatch(value: unknown): {
  sessionBudget?: string
  maxPerTransaction?: string
  autoApproveUnder?: string
  heartbeatTimeoutSeconds?: number
  transferPolicy?: WalletTransferPolicyPatch
} {
  const candidate = readRecord(value)
  const heartbeat = Number(candidate.heartbeatTimeoutSeconds)

  return {
    sessionBudget: readOptionalPositiveAmount(candidate.sessionBudget),
    maxPerTransaction: readOptionalPositiveAmount(
      candidate.maxPerTransaction ?? candidate.maxPerCall,
    ),
    autoApproveUnder: readOptionalPositiveAmount(candidate.autoApproveUnder),
    heartbeatTimeoutSeconds:
      Number.isFinite(heartbeat) && heartbeat > 0
        ? Math.round(heartbeat)
        : undefined,
    transferPolicy: readTransferPolicyPatch(candidate.transferPolicy),
  }
}

function normalizeServiceId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 96)
}

function normalizeVendorId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96)
}

function readServiceMethod(value: unknown): 'GET' | 'POST' {
  return readMaybeString(value)?.toUpperCase() === 'POST' ? 'POST' : 'GET'
}

function readServiceRequestMode(
  value: unknown,
  method: 'GET' | 'POST',
): 'query' | 'json' {
  const mode = readMaybeString(value)?.toLowerCase()
  if (mode === 'json') {
    return 'json'
  }
  if (mode === 'query') {
    return 'query'
  }

  return method === 'POST' ? 'json' : 'query'
}

function allowUnsafeServiceEndpoints(env: Env): boolean {
  return (
    env.PALMOS_ALLOW_UNSAFE_SERVICE_ENDPOINTS?.trim() === '1' ||
    env.PALMOS_ALLOW_UNSAFE_SERVICE_ENDPOINTS?.trim()?.toLowerCase() === 'true'
  )
}

function normalizeSolanaAddress(value: string): string | undefined {
  try {
    return new PublicKey(value.trim()).toBase58()
  } catch {
    return undefined
  }
}

export async function readRegisteredServiceInput(
  value: unknown,
  env: Env,
  options: {
    lookup?: EndpointLookup
  } = {},
): Promise<
  | Omit<
      RegisteredPalmosServiceRecord,
      'createdAt' | 'updatedAt' | 'status' | 'verifiedAt'
    >
  | undefined
> {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  const serviceId = normalizeServiceId(readMaybeString(candidate.serviceId) ?? '')
  const endpointUrl = readMaybeString(candidate.endpointUrl)
  const destinationAddress = readMaybeString(candidate.destinationAddress)
  const label = readMaybeString(candidate.label) ?? serviceId
  const method = readServiceMethod(candidate.method)
  const vendorId =
    normalizeVendorId(readMaybeString(candidate.vendorId) ?? serviceId) ||
    normalizeVendorId(serviceId)

  if (!serviceId || !endpointUrl || !destinationAddress || !vendorId) {
    return undefined
  }

  const normalizedDestinationAddress = normalizeSolanaAddress(destinationAddress)
  if (!normalizedDestinationAddress) {
    return undefined
  }

  const unsafeEndpointBypass = allowUnsafeServiceEndpoints(env)
  const allowedHostnames = readServiceEndpointAllowlist(env)
  if (!unsafeEndpointBypass) {
    const endpointSafety = await validateRegisteredServiceEndpoint({
      endpointUrl,
      lookup: options.lookup,
      allowedHostnames,
    })
    if (!endpointSafety.ok) {
      return undefined
    }
  } else {
    try {
      const parsedUrl = new URL(endpointUrl)
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return undefined
      }
      if (!isEndpointHostnameAllowlisted(parsedUrl.hostname, allowedHostnames)) {
        return undefined
      }
    } catch {
      return undefined
    }
  }

  return {
    serviceId,
    label,
    vendorId,
    destinationAddress: normalizedDestinationAddress,
    endpointUrl,
    method,
    requestMode: readServiceRequestMode(candidate.requestMode, method),
    expectedAmount: readPositiveAmount(candidate.expectedAmount, '0.01'),
    chainId: SOLANA_MAINNET_CHAIN_ID,
    verificationStatus: unsafeEndpointBypass ? 'unchecked' : 'verified',
    lastVerificationError: unsafeEndpointBypass
      ? 'Endpoint safety validation was bypassed by PALMOS_ALLOW_UNSAFE_SERVICE_ENDPOINTS.'
      : undefined,
  }
}
