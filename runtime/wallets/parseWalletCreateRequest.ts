import type {
  WalletCreateIntentPayload,
} from '../contracts/intent.js'
import type { RuntimeEnvironment } from '../contracts/common.js'

type WalletCreateRequestDraft = Omit<WalletCreateIntentPayload, 'environment'>

export type ParseWalletCreateRequestResult =
  | {
      ok: true
      payload: WalletCreateRequestDraft
    }
  | {
      ok: false
      error: string
    }

const CREATE_WALLET_PATTERN =
  /\bcreate\b(?:\s+(?:a|an))?\s+(treasury|ops|user|vendor)\s+wallet(?:\s+(?:for|profile\s+for)\s+([A-Za-z0-9._-]+))?(?:\s+(?:as|subject\s+type)\s+(individual|team|business))?(?:\s+(?:with\s+signer)\s+([A-Za-z0-9._-]+))?/i

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function inferSubjectType(
  walletType: WalletCreateIntentPayload['walletType'],
): WalletCreateIntentPayload['subjectType'] {
  switch (walletType) {
    case 'treasury':
    case 'ops':
      return 'team'
    case 'user':
      return 'individual'
    case 'vendor':
    default:
      return 'business'
  }
}

function isWalletCreatePayload(
  value: Record<string, unknown>,
): value is WalletCreateRequestDraft & { environment?: RuntimeEnvironment } {
  return (
    typeof value.subjectId === 'string' &&
    typeof value.walletType === 'string' &&
    typeof value.subjectType === 'string'
  )
}

export function parseWalletCreateRequest(input: {
  text?: string
  payload?: Record<string, unknown>
}): ParseWalletCreateRequestResult {
  if (input.payload && isWalletCreatePayload(input.payload)) {
    return {
      ok: true,
      payload: {
        subjectType: input.payload.subjectType,
        subjectId: input.payload.subjectId,
        walletType: input.payload.walletType,
        signerProfileId: normalizeString(input.payload.signerProfileId),
        initialPolicyProfileId: normalizeString(input.payload.initialPolicyProfileId),
      },
    }
  }

  if (!input.text) {
    return {
      ok: false,
      error: 'Wallet creation request is missing both structured payload and text.',
    }
  }

  const match = input.text.match(CREATE_WALLET_PATTERN)
  if (!match) {
    return {
      ok: false,
      error:
        'Could not parse wallet creation request text. Expected a pattern like "create vendor wallet for contractor_123 as business".',
    }
  }

  const walletType = match[1]
  const subjectId = match[2]
  const subjectType = match[3]
  const signerProfileId = match[4]
  if (!walletType) {
    return {
      ok: false,
      error: 'Wallet creation request is missing a wallet type.',
    }
  }
  if (!subjectId) {
    return {
      ok: false,
      error: 'Wallet creation request is missing a subject id.',
    }
  }

  const typedWalletType = walletType.toLowerCase() as WalletCreateIntentPayload['walletType']

  return {
    ok: true,
    payload: {
      subjectType:
        (subjectType?.toLowerCase() as WalletCreateIntentPayload['subjectType']) ??
        inferSubjectType(typedWalletType),
      subjectId,
      walletType: typedWalletType,
      signerProfileId: normalizeString(signerProfileId),
    },
  }
}
