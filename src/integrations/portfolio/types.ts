// Provider-agnostic portfolio read model.
//
// PalmOS reads wallet balances and recent activity through this interface so the
// product is never locked to a single external data provider. The first
// implementation is Solana-native (see solanaPortfolioReader.ts).

export type PortfolioSyncStatus =
  | { kind: 'synced'; chainId?: string; message: string }
  | { kind: 'empty'; chainId?: string; message: string }
  | { kind: 'unsupported_chain'; chainId: string; message: string }
  | { kind: 'request_failed'; chainId?: string; message: string }
  | { kind: 'missing_wallet_address'; chainId?: string; message: string }
  | { kind: 'disabled'; chainId?: string; message: string }

export type WalletPortfolioPosition = {
  id?: string
  symbol?: string
  chainId?: string
  value?: number
  quantity?: number
}

export type WalletPortfolioTransaction = {
  id?: string
  hash?: string
  chainId?: string
  operationType?: string
  minedAt?: string
  direction?: string
  value?: number
}

export type WalletPortfolioSnapshot = {
  address: string
  positions: WalletPortfolioPosition[]
  transactions: WalletPortfolioTransaction[]
  sync: PortfolioSyncStatus
}

export interface PortfolioReader {
  getWalletSnapshot(
    address: string,
    options?: { chainId?: string },
  ): Promise<WalletPortfolioSnapshot>
}

// Provider-agnostic USD price source, mirroring PortfolioReader so the product is
// never locked to one price vendor. Implementations resolve live USD prices keyed
// by on-chain mint address. Pricing is best-effort enrichment: a PriceOracle must
// never throw and should simply omit any mint it cannot price (the caller leaves
// that position's USD value undefined rather than fabricating a number).
export interface PriceOracle {
  getUsdPrices(mints: string[]): Promise<Map<string, number>>
}
