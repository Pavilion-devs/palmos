import type { BroadcastPrivacyPath } from '../../../runtime/index.js'

export type UmbraNetwork = 'devnet' | 'mainnet' | 'localnet'
export type UmbraAssetSymbol = 'wSOL' | 'dUSDC' | 'dUSDT'

export const UMBRA_PAYMENT_RAIL = 'umbra' as const
export const UMBRA_PRIVATE_SERVICE_ID = 'umbra.private_settlement' as const
export const UMBRA_DEFAULT_VENDOR_ID = 'umbra_private_recipient' as const
export const UMBRA_DEFAULT_PRIVACY_PATH: BroadcastPrivacyPath = 'umbra_mixer_utxo'

export const UMBRA_TOKEN_DECIMALS: Record<string, number> = {
  dUSDC: 6,
  dUSDT: 6,
  wSOL: 9,
}

export function toSolanaChainId(network: UmbraNetwork): string {
  switch (network) {
    case 'mainnet':
      return 'solana-mainnet'
    case 'localnet':
      return 'solana-local'
    case 'devnet':
      return 'solana-devnet'
  }
}

export function toUmbraNetwork(chainId: string | undefined): UmbraNetwork {
  switch (chainId) {
    case 'solana-mainnet':
      return 'mainnet'
    case 'solana-local':
      return 'localnet'
    case 'solana-devnet':
    default:
      return 'devnet'
  }
}

export function defaultUmbraMintAddresses(
  network: UmbraNetwork,
): Record<UmbraAssetSymbol, string> {
  if (network === 'mainnet') {
    return {
      dUSDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      dUSDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      wSOL: 'So11111111111111111111111111111111111111112',
    }
  }

  return {
    dUSDC: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
    dUSDT: 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6',
    wSOL: 'So11111111111111111111111111111111111111112',
  }
}

export function defaultUmbraIndexerApiEndpoint(
  network: UmbraNetwork,
): string | undefined {
  switch (network) {
    case 'mainnet':
      return 'https://utxo-indexer.api.umbraprivacy.com'
    case 'devnet':
      return 'https://utxo-indexer.api-devnet.umbraprivacy.com'
    case 'localnet':
      return undefined
  }
}

export function defaultUmbraRelayerApiEndpoint(
  network: UmbraNetwork,
): string | undefined {
  switch (network) {
    case 'mainnet':
      return 'https://relayer.api.umbraprivacy.com'
    case 'devnet':
      return 'https://relayer.api-devnet.umbraprivacy.com'
    case 'localnet':
      return undefined
  }
}
