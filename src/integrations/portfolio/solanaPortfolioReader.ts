import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedAccountData,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js'
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { JupiterPriceOracle } from './jupiterPriceOracle.js'
import {
  PUSD_SYMBOL,
  PUSD_TOKEN_PROGRAM_ID,
  readPusdMintFromEnv,
  readPusdNetworkFromEnv,
  readSolanaRpcUrlFromEnv,
  type SolanaCluster,
} from '../pusd/constants.js'
import { knownUsdcMints } from '../pusd/splAssets.js'
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
type KnownToken = { symbol: string; stableUsd?: boolean }
type ObservedTokenAccount = {
  address: string
  mint: string
  symbol: string
}
type PriceablePosition = {
  position: WalletPortfolioPosition
  mint: string
  requiredValuation: boolean
}
type AssetDelta = {
  symbol: string
  amount: number
  direction: 'in' | 'out'
}

const SIGNATURES_PER_ADDRESS = 10
const MAX_RECENT_TRANSACTIONS = 20
const ASSET_DELTA_EPSILON = 1e-9

function buildKnownTokens(pusdMint: string): Map<string, KnownToken> {
  const known = new Map<string, KnownToken>([
    [pusdMint, { symbol: PUSD_SYMBOL, stableUsd: true }],
  ])
  // Recognize USDC on every cluster (mainnet + devnet), not just mainnet — a
  // devnet wallet holds the devnet USDC mint, which must still value at ~$1.
  for (const mint of knownUsdcMints()) {
    known.set(mint, { symbol: 'USDC', stableUsd: true })
  }
  return known
}

function shortMint(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint
}

function readPubkey(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof PublicKey) {
    return value.toBase58()
  }
  if (value && typeof value === 'object' && 'pubkey' in value) {
    const nested = (value as { pubkey?: unknown }).pubkey
    if (typeof nested === 'string') {
      return nested
    }
    if (nested instanceof PublicKey) {
      return nested.toBase58()
    }
  }
  return undefined
}

function readParsedTokenAccountAddress(value: unknown): string | undefined {
  if (value && typeof value === 'object' && 'pubkey' in value) {
    return readPubkey((value as { pubkey?: unknown }).pubkey)
  }
  return undefined
}

function readUiTokenAmount(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const tokenAmount = value as {
    uiAmount?: number
    uiAmountString?: string
  }
  if (typeof tokenAmount.uiAmount === 'number') {
    return tokenAmount.uiAmount
  }
  const parsed = Number(tokenAmount.uiAmountString)
  return Number.isFinite(parsed) ? parsed : undefined
}

function hasMeaningfulDelta(value: number): boolean {
  return Math.abs(value) > ASSET_DELTA_EPSILON
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
      // Token accounts live under TWO programs: the classic SPL Token program
      // (USDC, wrapped SOL, most SPL) and Token-2022 (PUSD). Querying only one
      // silently drops the other's balances — so scan both and merge.
      const [lamports, classicTokens, token2022Tokens] =
        await Promise.all([
          this.connection.getBalance(owner),
          this.connection.getParsedTokenAccountsByOwner(owner, {
            programId: TOKEN_PROGRAM_ID,
          }),
          this.connection.getParsedTokenAccountsByOwner(owner, {
            programId: new PublicKey(PUSD_TOKEN_PROGRAM_ID),
          }),
        ])
      const tokenAccounts = [
        ...classicTokens.value,
        ...token2022Tokens.value,
      ]

      const positions: WalletPortfolioPosition[] = []
      const observedTokenAccounts: ObservedTokenAccount[] = []
      // Positions whose USD value is resolved live from the price oracle, paired
      // with the mint to price (SOL is priced via the wrapped-SOL mint).
      const priceable: PriceablePosition[] = []

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
        priceable.push({
          position: solPosition,
          mint: NATIVE_MINT.toBase58(),
          requiredValuation: true,
        })
      }

      for (const tokenAccount of tokenAccounts) {
        const { account } = tokenAccount
        const info = readParsedTokenInfo(account.data)
        if (!info || info.uiAmount <= 0) {
          continue
        }
        const known = this.knownTokens.get(info.mint)
        const symbol = known?.symbol ?? shortMint(info.mint)
        const position: WalletPortfolioPosition = {
          id: `${walletAddress}:${info.mint}`,
          symbol,
          chainId,
          quantity: info.uiAmount,
          // Known stablecoins keep the ~$1 peg shortcut (no network call);
          // everything else is priced live by the oracle below.
          value: known?.stableUsd ? info.uiAmount : undefined,
        }
        positions.push(position)
        const tokenAccountAddress = readParsedTokenAccountAddress(tokenAccount)
        if (tokenAccountAddress) {
          observedTokenAccounts.push({
            address: tokenAccountAddress,
            mint: info.mint,
            symbol,
          })
        }
        if (!known?.stableUsd) {
          priceable.push({
            position,
            mint: info.mint,
            requiredValuation: false,
          })
        }
      }

      await this.applyLivePrices(priceable)
      let recentTransactions: WalletPortfolioTransaction[] = []
      let activityUnavailable = false
      try {
        const signatureInfos = await this.collectRecentSignatures(
          owner,
          observedTokenAccounts,
        )
        recentTransactions = await this.buildRecentTransactions({
          chainId,
          owner,
          signatureInfos,
          tokenAccounts: observedTokenAccounts,
        })
      } catch (activityError) {
        if (process.env.PALMOS_DEBUG_PORTFOLIO) {
          console.error('[portfolio] recent activity fetch failed:', activityError)
        }
        activityUnavailable = true
      }

      const hasData = positions.length > 0 || recentTransactions.length > 0
      return {
        address: walletAddress,
        positions,
        transactions: recentTransactions,
        valuationComplete: this.hasCompleteValuation(positions, priceable),
        sync: hasData
          ? {
              kind: 'synced',
              chainId,
              message: activityUnavailable
                ? `Synced balances on ${chainId}; recent activity unavailable.`
                : `Synced on ${chainId}.`,
            }
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
    priceable: PriceablePosition[],
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

  private hasCompleteValuation(
    positions: WalletPortfolioPosition[],
    priceable: PriceablePosition[],
  ): boolean {
    const requiredSymbols = new Set(
      priceable
        .filter((entry) => entry.requiredValuation)
        .map((entry) => entry.position.symbol)
        .filter((symbol): symbol is string => Boolean(symbol)),
    )
    if (requiredSymbols.size === 0) {
      return true
    }
    return positions.every((position) => {
      if (!position.symbol || !requiredSymbols.has(position.symbol)) {
        return true
      }
      return typeof position.value === 'number' && Number.isFinite(position.value)
    })
  }

  private async collectRecentSignatures(
    owner: PublicKey,
    tokenAccounts: ObservedTokenAccount[],
  ): Promise<ConfirmedSignatureInfo[]> {
    const targets = [
      owner,
      ...tokenAccounts.map((account) => new PublicKey(account.address)),
    ]
    const signatureLists = await Promise.all(
      targets.map((target) =>
        this.connection.getSignaturesForAddress(target, {
          limit: SIGNATURES_PER_ADDRESS,
        }),
      ),
    )
    const deduped = new Map<string, ConfirmedSignatureInfo>()
    for (const list of signatureLists) {
      for (const signature of list) {
        const current = deduped.get(signature.signature)
        if (!current || (signature.blockTime ?? 0) > (current.blockTime ?? 0)) {
          deduped.set(signature.signature, signature)
        }
      }
    }
    return [...deduped.values()]
      .sort((left, right) => {
        const leftAt = left.blockTime ?? 0
        const rightAt = right.blockTime ?? 0
        return rightAt - leftAt || right.signature.localeCompare(left.signature)
      })
      .slice(0, MAX_RECENT_TRANSACTIONS)
  }

  private async buildRecentTransactions(input: {
    chainId: string
    owner: PublicKey
    signatureInfos: ConfirmedSignatureInfo[]
    tokenAccounts: ObservedTokenAccount[]
  }): Promise<WalletPortfolioTransaction[]> {
    if (input.signatureInfos.length === 0) {
      return []
    }
      // Fetch per-signature, not as a batch RPC: batch getParsedTransactions is blocked on free
      // RPC tiers (e.g. Helius returns 403 "Batch requests are only available for paid plans"),
      // which would silently drop ALL recent activity (incl. funding). Small concurrency stays
      // under per-second limits; a failed single lookup degrades to null rather than failing all.
      const signatures = input.signatureInfos.map((signature) => signature.signature)
      const parsedTransactions: (ParsedTransactionWithMeta | null)[] = []
      const FETCH_CONCURRENCY = 5
      for (let i = 0; i < signatures.length; i += FETCH_CONCURRENCY) {
        const chunk = signatures.slice(i, i + FETCH_CONCURRENCY)
        const results = await Promise.all(
          chunk.map((signature) =>
            this.connection
              .getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 })
              .catch(() => null),
          ),
        )
        parsedTransactions.push(...results)
      }
    const tokenAccountsByAddress = new Map(
      input.tokenAccounts.map((account) => [account.address, account]),
    )
    return input.signatureInfos.map((signatureInfo, index) => {
      const parsed = parsedTransactions[index]
      return this.projectRecentTransaction({
        chainId: input.chainId,
        ownerAddress: input.owner.toBase58(),
        signatureInfo,
        parsed: parsed ?? null,
        tokenAccountsByAddress,
      })
    })
  }

  private projectRecentTransaction(input: {
    chainId: string
    ownerAddress: string
    signatureInfo: ConfirmedSignatureInfo
    parsed: ParsedTransactionWithMeta | null
    tokenAccountsByAddress: Map<string, ObservedTokenAccount>
  }): WalletPortfolioTransaction {
    const base: WalletPortfolioTransaction = {
      id: input.signatureInfo.signature,
      hash: input.signatureInfo.signature,
      chainId: input.chainId,
      minedAt: input.signatureInfo.blockTime
        ? new Date(input.signatureInfo.blockTime * 1000).toISOString()
        : undefined,
    }
    if (!input.parsed?.meta) {
      return base
    }

    const deltas: AssetDelta[] = []
    const ownerSolDelta = this.readOwnerSolDelta(
      input.parsed,
      input.ownerAddress,
    )
    if (ownerSolDelta != null && hasMeaningfulDelta(ownerSolDelta)) {
      deltas.push({
        symbol: 'SOL',
        amount: Math.abs(ownerSolDelta),
        direction: ownerSolDelta > 0 ? 'in' : 'out',
      })
    }

    for (const delta of this.readTokenDeltas(
      input.parsed,
      input.tokenAccountsByAddress,
    )) {
      deltas.push(delta)
    }

    if (deltas.length === 0) {
      return base
    }

    const inbound = deltas.filter((delta) => delta.direction === 'in')
    const outbound = deltas.filter((delta) => delta.direction === 'out')
    const primary =
      [...inbound, ...outbound].sort((left, right) => right.amount - left.amount)[0]
    if (!primary) {
      return base
    }

    return {
      ...base,
      operationType:
        inbound.length > 0 && outbound.length > 0
          ? 'swap'
          : inbound.length > 0
            ? 'deposit'
            : 'send',
      direction: primary.direction,
      assetSymbol: primary.symbol,
      amount: primary.amount,
      value: primary.amount,
    }
  }

  private readOwnerSolDelta(
    parsed: ParsedTransactionWithMeta,
    ownerAddress: string,
  ): number | undefined {
    const accountKeys = parsed.transaction.message.accountKeys
    const ownerIndex = accountKeys.findIndex(
      (entry) => readPubkey(entry) === ownerAddress,
    )
    if (ownerIndex < 0) {
      return undefined
    }
    const pre = parsed.meta?.preBalances?.[ownerIndex]
    const post = parsed.meta?.postBalances?.[ownerIndex]
    if (
      typeof pre !== 'number' ||
      typeof post !== 'number'
    ) {
      return undefined
    }
    return (post - pre) / LAMPORTS_PER_SOL
  }

  private readTokenDeltas(
    parsed: ParsedTransactionWithMeta,
    tokenAccountsByAddress: Map<string, ObservedTokenAccount>,
  ): AssetDelta[] {
    const accountKeys = parsed.transaction.message.accountKeys
    const preBalances = new Map<number, number>()
    for (const entry of parsed.meta?.preTokenBalances ?? []) {
      const amount = readUiTokenAmount(entry.uiTokenAmount)
      if (typeof amount === 'number') {
        preBalances.set(entry.accountIndex, amount)
      }
    }
    const postBalances = new Map<number, number>()
    for (const entry of parsed.meta?.postTokenBalances ?? []) {
      const amount = readUiTokenAmount(entry.uiTokenAmount)
      if (typeof amount === 'number') {
        postBalances.set(entry.accountIndex, amount)
      }
    }
    const observedIndexes = new Set([
      ...preBalances.keys(),
      ...postBalances.keys(),
    ])
    const deltas: AssetDelta[] = []
    for (const accountIndex of observedIndexes) {
      const address = readPubkey(accountKeys[accountIndex])
      if (!address) {
        continue
      }
      const tokenAccount = tokenAccountsByAddress.get(address)
      if (!tokenAccount) {
        continue
      }
      const delta =
        (postBalances.get(accountIndex) ?? 0) -
        (preBalances.get(accountIndex) ?? 0)
      if (!hasMeaningfulDelta(delta)) {
        continue
      }
      deltas.push({
        symbol: tokenAccount.symbol,
        amount: Math.abs(delta),
        direction: delta > 0 ? 'in' : 'out',
      })
    }
    return deltas
  }
}
