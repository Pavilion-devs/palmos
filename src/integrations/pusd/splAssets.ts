import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  PUSD_DECIMALS,
  PUSD_TOKEN_PROGRAM_ID,
  readPusdMintFromEnv,
  readPusdNetworkFromEnv,
  type SolanaCluster,
} from './constants.js'

// Everything needed to build a real SPL token transfer for a known asset.
export type SplAssetSettlement = {
  symbol: string
  mint: string
  decimals: number
  tokenProgramId: string
}

// Canonical USDC mints per Solana cluster (Circle). USDC uses the classic SPL
// Token program (NOT Token-2022). Overridable via USDC_MINT for custom clusters
// or a local test mint.
export const USDC_MINTS: Record<SolanaCluster, string | undefined> = {
  'solana-mainnet': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana-devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  'solana-local': undefined,
}

const USDC_DECIMALS = 6

// Every known USDC mint across clusters — used by the portfolio reader to label
// + value USDC regardless of which cluster a wallet is read on.
export function knownUsdcMints(): string[] {
  return Object.values(USDC_MINTS).filter((mint): mint is string => Boolean(mint))
}

// Resolve how to settle a non-SOL asset transfer on-chain, or undefined if we
// don't have a real settlement path for it (caller leaves it on the deterministic
// path rather than faking a success). PUSD rides the Token-2022 program; USDC the
// classic Token program. Symbols are matched case-insensitively.
export function resolveSplAssetSettlement(
  assetSymbol: string,
  env: Record<string, string | undefined> = process.env,
): SplAssetSettlement | undefined {
  const symbol = assetSymbol.trim().toUpperCase()

  if (symbol === 'PUSD') {
    return {
      symbol,
      mint: readPusdMintFromEnv(env),
      decimals: PUSD_DECIMALS,
      tokenProgramId: PUSD_TOKEN_PROGRAM_ID,
    }
  }

  if (symbol === 'USDC') {
    const network = readPusdNetworkFromEnv(env)
    const mint = env.USDC_MINT?.trim() || USDC_MINTS[network]
    if (!mint) {
      return undefined
    }
    return {
      symbol,
      mint,
      decimals: USDC_DECIMALS,
      tokenProgramId: TOKEN_PROGRAM_ID.toBase58(),
    }
  }

  return undefined
}

// Parse a decimal token amount string into integer base units for the given
// decimals, with no floating-point drift (e.g. "1.5" @ 6 -> 1500000n).
export function tokenAmountToBaseUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim()
  const negative = trimmed.startsWith('-')
  const [whole, fraction = ''] = trimmed.replace('-', '').split('.')
  const fractionPadded = (fraction + '0'.repeat(decimals)).slice(0, decimals)
  const base =
    BigInt(whole || '0') * 10n ** BigInt(decimals) +
    BigInt(fractionPadded || '0')
  return negative ? -base : base
}
