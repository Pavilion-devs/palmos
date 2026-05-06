import type { AssetTransferIntentPayload } from '../contracts/intent.js'

export type ParseTransferRequestResult =
  | {
      ok: true
      payload: AssetTransferIntentPayload
    }
  | {
      ok: false
      error: string
    }

const TRANSFER_PATTERN =
  /\b(?:send|pay|transfer)\s+([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z0-9._-]+)\s+to\s+(\S+?)(?:\s+(?:on|via)\s+([A-Za-z0-9._-]+))?(?:\s|$)/i

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isTransferPayload(
  value: Record<string, unknown>,
): value is AssetTransferIntentPayload {
  return (
    typeof value.destinationAddress === 'string' &&
    typeof value.chainId === 'string' &&
    typeof value.assetSymbol === 'string' &&
    typeof value.amount === 'string'
  )
}

export function parseTransferRequest(input: {
  text?: string
  payload?: Record<string, unknown>
}): ParseTransferRequestResult {
  if (input.payload && isTransferPayload(input.payload)) {
    return {
      ok: true,
      payload: {
        sourceWalletId: normalizeString(input.payload.sourceWalletId),
        destinationAddress: input.payload.destinationAddress,
        chainId: input.payload.chainId,
        assetSymbol: input.payload.assetSymbol,
        amount: input.payload.amount,
        counterpartyId: normalizeString(input.payload.counterpartyId),
        note: normalizeString(input.payload.note),
      },
    }
  }

  if (!input.text) {
    return {
      ok: false,
      error: 'Transfer request is missing both structured payload and text.',
    }
  }

  const match = input.text.match(TRANSFER_PATTERN)
  if (!match) {
    return {
      ok: false,
      error:
        'Could not parse transfer request text. Expected a pattern like "send 100 USDC to 0xabc on base".',
    }
  }

  const amount = match[1]
  const assetSymbol = match[2]
  const destinationAddress = match[3]
  const chainId = match[4]
  if (!amount || !assetSymbol || !destinationAddress) {
    return {
      ok: false,
      error:
        'Could not parse transfer request text. Expected amount, asset, and destination address.',
    }
  }

  return {
    ok: true,
    payload: {
      destinationAddress,
      chainId: chainId ?? 'unknown',
      assetSymbol: assetSymbol.toUpperCase(),
      amount,
    },
  }
}
