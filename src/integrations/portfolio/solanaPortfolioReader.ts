import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  type ParsedAccountData,
} from '@solana/web3.js'
import { NATIVE_MINT } from '@solana/spl-token'
import { JupiterPriceOracle } from './jupiterPriceOracle.js'
import {
  PUSD_SYMBOL,
  PUSD_TOKEN_PROGRAM_ID,
  readPusdMintFromEnv,
  readPusdNetworkFromEnv,
  readSolanaRpcUrlFromEnv,
  type SolanaCluster,
} from '../pusd/constants.js'
import type {
  PortfolioReader,
  PortfolioSyncStatus,
  PriceOracle,
  WalletPortfolioPosition,
  WalletPortfolioSnapshot,
  WalletPortfolioTransaction,
} from './types.js'

// Well-known SPL mints we can label and (for stablecoins) value at ~$1 without a
// price oracle. Everything else is reported by on-chain amount with no USD value;
// pricing volatile assets is a deliberate later decision, not an external
// dependency we take on now.
const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

type KnownToken = { symbol: string; stableUsd?: boolean }

function buildKnownTokens(pusdMint: string): Map<string, KnownToken> {
  return new Map<string, KnownToken>([
    [pusdMint, { symbol: PUSD_SYMBOL, stableUsd: true }],
    [USDC_MAINNET_MINT, { symbol: 'USDC', stableUsd: true }],
  ])
}

function shortMint(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint
}

function emptySnapshot(
  address: string,
  sync: PortfolioSyncStatus,
): WalletPortfolioSnapshot {
  return { address, positions: [], transactions: [], sync }
}

function readParsedTokenInfo(
  data: Buffer | ParsedAccountData,
): { mint: string; uiAmount: number } | undefined {
  if (!data || data instanceof Buffer || !('parsed' in data)) {
    return undefined
  }
  const parsed = (data.parsed ?? {}) as Record<string, unknown>
  const info = (parsed.info ?? {}) as Record<string, unknown>
  const mint = typeof info.mint === 'string' ? info.mint : undefined
  const tokenAmount = (info.tokenAmount ?? {}) as Record<string, unknown>
  const uiAmount =
    typeof tokenAmount.uiAmount === 'number'
      ? tokenAmount.uiAmount
      : Number(tokenAmount.uiAmountString)
  if (!mint || !Number.isFinite(uiAmount)) {
    return undefined
  }
  return { mint, uiAmount }
}

export type SolanaPortfolioReaderConfig = {
  rpcUrl: string
  chainId: SolanaCluster
  pusdMint: string
}

export function readSolanaPortfolioConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SolanaPortfolioReaderConfig {
  return {
    rpcUrl: readSolanaRpcUrlFromEnv(env),
    chainId: readPusdNetworkFromEnv(env),
    pusdMint: readPusdMintFromEnv(env),
  }
}

export class SolanaPortfolioReader implements PortfolioReader {
  private readonly knownTokens: Map<string, KnownToken>

  constructor(
    private readonly config: SolanaPortfolioReaderConfig,
    private readonly connection: Connection = new Connection(
      config.rpcUrl,
      'confirmed',
    ),
    private readonly priceOracle?: PriceOracle,
  ) {
    this.knownTokens = buildKnownTokens(config.pusdMint)
  }

  static fromEnv(
    env: Record<string, string | undefined> = process.env,
  ): SolanaPortfolioReader {
    return new SolanaPortfolioReader(
      readSolanaPortfolioConfigFromEnv(env),
      undefined,
      JupiterPriceOracle.fromEnv(env),
    )
  }

  async getWalletSnapshot(
    address: string,
    options?: { chainId?: string },
  ): Promise<WalletPortfolioSnapshot> {
    const walletAddress = address.trim()
    const chainId = this.config.chainId

    if (!walletAddress) {
      return emptySnapshot('', {
        kind: 'missing_wallet_address',
        chainId,
        message: 'Wallet address unavailable for Solana portfolio sync.',
      })
    }

    // This reader is Solana-only. If a non-Solana chain is explicitly requested,
    // report it as unsupported rather than silently returning Solana data.
    const requested = options?.chainId?.trim()
    if (requested && !requested.startsWith('solana')) {
      return emptySnapshot(walletAddress, {
        kind: 'unsupported_chain',
        chainId: requested,
        message: `Solana portfolio reader does not cover ${requested}.`,
      })
    }

    let owner: PublicKey
    try {
      owner = new PublicKey(walletAddress)
    } catch {
      return emptySnapshot(walletAddress, {
        kind: 'request_failed',
        chainId,
        message: 'Wallet address is not a valid Solana public key.',
      })
    }

    try {
      const [lamports, tokenAccounts, signatures] = await Promise.all([
        this.connection.getBalance(owner),
        this.connection.getParsedTokenAccountsByOwner(owner, {
          programId: new PublicKey(PUSD_TOKEN_PROGRAM_ID),
        }),
        this.connection.getSignaturesForAddress(owner, { limit: 10 }),
      ])

      const positions: WalletPortfolioPosition[] = []
      // Positions whose USD value is resolved live from the price oracle, paired
      // with the mint to price (SOL is priced via the wrapped-SOL mint).
      const priceable: Array<{
        position: WalletPortfolioPosition
        mint: string
      }> = []

      const solQuantity = lamports / LAMPORTS_PER_SOL
      if (solQuantity > 0) {
        const solPosition: WalletPortfolioPosition = {
          id: `${walletAddress}:SOL`,
          symbol: 'SOL',
          chainId,
          quantity: solQuantity,
          value: undefined, // filled live below when a price oracle is configured
        }
        positions.push(solPosition)
        priceable.push({ position: solPosition, mint: NATIVE_MINT.toBase58() })
      }

      for (const { account } of tokenAccounts.value) {
        const info = readParsedTokenInfo(account.data)
        if (!info || info.uiAmount <= 0) {
          continue
        }
        const known = this.knownTokens.get(info.mint)
        const position: WalletPortfolioPosition = {
          id: `${walletAddress}:${info.mint}`,
          symbol: known?.symbol ?? shortMint(info.mint),
          chainId,
          quantity: info.uiAmount,
          // Known stablecoins keep the ~$1 peg shortcut (no network call);
          // everything else is priced live by the oracle below.
          value: known?.stableUsd ? info.uiAmount : undefined,
        }
        positions.push(position)
        if (!known?.stableUsd) {
          priceable.push({ position, mint: info.mint })
        }
      }

      await this.applyLivePrices(priceable)

      const transactions: WalletPortfolioTransaction[] = signatures.map(
        (sig) => ({
          id: sig.signature,
          hash: sig.signature,
          chainId,
          minedAt: sig.blockTime
            ? new Date(sig.blockTime * 1000).toISOString()
            : undefined,
        }),
      )

      const hasData = positions.length > 0 || transactions.length > 0
      return {
        address: walletAddress,
        positions,
        transactions,
        sync: hasData
          ? { kind: 'synced', chainId, message: `Synced on ${chainId}.` }
          : {
              kind: 'empty',
              chainId,
              message: `No Solana activity found on ${chainId}.`,
            },
      }
    } catch (error) {
      return emptySnapshot(walletAddress, {
        kind: 'request_failed',
        chainId,
        message:
          error instanceof Error ? error.message : 'Solana RPC request failed.',
      })
    }
  }

  // Best-effort live USD enrichment. Failures never propagate: positions simply
  // keep an undefined value, exactly as if no oracle were configured. This keeps
  // pricing strictly additive over the RPC balance read.
  private async applyLivePrices(
    priceable: Array<{ position: WalletPortfolioPosition; mint: string }>,
  ): Promise<void> {
    if (!this.priceOracle || priceable.length === 0) {
      return
    }
    try {
      const prices = await this.priceOracle.getUsdPrices(
        priceable.map((entry) => entry.mint),
      )
      for (const { position, mint } of priceable) {
        const price = prices.get(mint)
        if (
          typeof price === 'number' &&
          Number.isFinite(price) &&
          typeof position.quantity === 'number'
        ) {
          position.value = position.quantity * price
        }
      }
    } catch {
      // Pricing is enrichment only — never fail a snapshot over it.
    }
  }
}
