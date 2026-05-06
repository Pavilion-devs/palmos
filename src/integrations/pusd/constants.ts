export const PALMOS_PAYMENT_RAIL = 'palmos-pusd' as const
export const PUSD_SYMBOL = 'PUSD' as const
export const PUSD_DECIMALS = 6
export const PUSD_SOLANA_MINT =
  'CZzgUBvxaMLwMhVSLgqJn3npmxoTo6nzMNQPAnwtHF3s'
export const PALMOS_LOCAL_DEMO_MERCHANT_WALLET =
  '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy'

export type PalmosPaymentRail = typeof PALMOS_PAYMENT_RAIL
export type PusdSymbol = typeof PUSD_SYMBOL

export type SolanaCluster =
  | 'solana-mainnet'
  | 'solana-devnet'
  | 'solana-local'

export const SOLANA_MAINNET_CHAIN_ID: SolanaCluster = 'solana-mainnet'
export const SOLANA_DEVNET_CHAIN_ID: SolanaCluster = 'solana-devnet'
export const SOLANA_LOCAL_CHAIN_ID: SolanaCluster = 'solana-local'

export function readPusdMintFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.PUSD_MINT?.trim() || PUSD_SOLANA_MINT
}

export function readPusdNetworkFromEnv(
  env: Record<string, string | undefined> = process.env,
): SolanaCluster {
  const configured = env.PUSD_SOLANA_NETWORK?.trim()
  if (configured === 'devnet' || configured === SOLANA_DEVNET_CHAIN_ID) {
    return SOLANA_DEVNET_CHAIN_ID
  }
  if (configured === 'local' || configured === SOLANA_LOCAL_CHAIN_ID) {
    return SOLANA_LOCAL_CHAIN_ID
  }
  return SOLANA_MAINNET_CHAIN_ID
}

export function readSolanaRpcUrlFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.PUSD_SOLANA_RPC_URL?.trim()
  if (configured) {
    return configured
  }

  const network = readPusdNetworkFromEnv(env)
  if (network === SOLANA_DEVNET_CHAIN_ID) {
    return 'https://api.devnet.solana.com'
  }
  if (network === SOLANA_LOCAL_CHAIN_ID) {
    return 'http://127.0.0.1:8899'
  }
  return 'https://api.mainnet-beta.solana.com'
}
