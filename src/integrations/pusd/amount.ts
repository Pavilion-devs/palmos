import { PUSD_DECIMALS } from './constants.js'

export function parsePusdAmountToBaseUnits(amount: string): bigint {
  const normalized = amount.trim()
  if (!normalized) {
    throw new Error('PUSD amount cannot be empty.')
  }

  const [wholePart = '', fractionalPart = ''] = normalized.split('.')
  const whole = wholePart === '' ? '0' : wholePart
  const fraction = `${fractionalPart}${'0'.repeat(PUSD_DECIMALS)}`.slice(
    0,
    PUSD_DECIMALS,
  )

  if (!/^\d+$/.test(whole) || !/^\d{0,6}$/.test(fractionalPart)) {
    throw new Error(`Invalid PUSD amount: ${amount}`)
  }

  return BigInt(whole) * 10n ** BigInt(PUSD_DECIMALS) + BigInt(fraction || '0')
}

export function formatPusdBaseUnits(amount: bigint): string {
  const scale = 10n ** BigInt(PUSD_DECIMALS)
  const whole = amount / scale
  const fraction = amount % scale
  const fractionText = fraction.toString().padStart(PUSD_DECIMALS, '0')
  const trimmedFraction = fractionText.replace(/0+$/, '')
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString()
}
