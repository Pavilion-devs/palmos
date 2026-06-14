/**
 * Mantle Sepolia testnet (chainId 5003) — the chain PalmOS records agent identity + decisions on.
 * Solana/Byreal execution is untouched; Mantle is the additive identity + audit layer.
 */
import { defineChain } from 'viem'

export const MANTLE_SEPOLIA_CHAIN_ID = 5003
export const MANTLE_SEPOLIA_RPC_URL = 'https://rpc.sepolia.mantle.xyz'
// Mantle's canonical Sepolia explorer is the Etherscan-based Mantlescan; the old Blockscout host
// (explorer.sepolia.mantle.xyz) now just 302-redirects here, so we link Mantlescan directly.
export const MANTLE_SEPOLIA_EXPLORER = 'https://sepolia.mantlescan.xyz'

export const mantleSepolia = defineChain({
  id: MANTLE_SEPOLIA_CHAIN_ID,
  name: 'Mantle Sepolia',
  nativeCurrency: { name: 'Mantle', symbol: 'MNT', decimals: 18 },
  rpcUrls: { default: { http: [MANTLE_SEPOLIA_RPC_URL] } },
  blockExplorers: {
    default: { name: 'Mantle Sepolia Explorer', url: MANTLE_SEPOLIA_EXPLORER },
  },
  testnet: true,
})

export function mantleTxUrl(txHash: string, explorer: string = MANTLE_SEPOLIA_EXPLORER): string {
  return `${explorer}/tx/${txHash}`
}

export function mantleAddressUrl(
  address: string,
  explorer: string = MANTLE_SEPOLIA_EXPLORER,
): string {
  return `${explorer}/address/${address}`
}

/** Explorer link to a specific ERC-721 token instance (the agent identity NFT). */
export function mantleTokenInstanceUrl(
  contract: string,
  tokenId: bigint | number | string,
  explorer: string = MANTLE_SEPOLIA_EXPLORER,
): string {
  // Etherscan-style NFT instance path (Mantlescan): /nft/<contract>/<tokenId>.
  return `${explorer}/nft/${contract}/${tokenId}`
}
