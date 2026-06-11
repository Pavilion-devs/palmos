import { useMemo } from 'react'
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react'
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets'

// SIWS only signs a message — no RPC is performed — but ConnectionProvider still
// wants an endpoint. Default to mainnet; override with VITE_SOLANA_RPC_URL.
const ENDPOINT =
  import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

export function WalletProviders({ children }) {
  // Phantom + Solflare are listed explicitly; any other wallet-standard wallet
  // the user has installed is auto-detected by the adapter too.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  )

  return (
    <ConnectionProvider endpoint={ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  )
}
