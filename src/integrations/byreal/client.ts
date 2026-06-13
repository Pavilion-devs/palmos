/**
 * ByrealClient — thin, typed wrapper over the Byreal Agent Skills CLI (`byreal-cli`).
 *
 * This is C1 of the PalmOS × Byreal integration (see byrealintegration.md, Appendix A).
 * It shells out to `byreal-cli ... -o json`. Read-only methods (`listPools`, `listTokens`,
 * `quoteSwap`) need no wallet and hit Byreal's public Solana mainnet API — they are safe and
 * demoable on their own. `buildSwapUnsigned` produces an UNSIGNED base64 VersionedTransaction
 * via `--unsigned-tx --wallet-address <owner>` and still never touches a private key; the OWS
 * vault signs it downstream in C2 (`signAndBroadcastSolanaTx`).
 *
 * JSON shapes were captured against byreal-cli@0.3.6 / api2.byreal.io:
 *   read-only  -> { success, meta, data }   (dry-run swap also prints a `[DRY RUN]` banner first)
 *   --unsigned-tx -> { unsignedTransactions: [base64], extraSignerPublicKey? }   (no envelope)
 */
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export type ByrealClientConfig = {
  /** CLI binary; defaults to env BYREAL_CLI_BIN or `byreal-cli` (must be installed). */
  bin?: string
  /** Override Byreal API base (env BYREAL_API_URL). Defaults to https://api2.byreal.io. */
  apiUrl?: string
  /** Override Solana RPC (env SOLANA_RPC_URL). Byreal targets mainnet-beta. */
  rpcUrl?: string
  /** Per-command timeout in ms (default 30s). */
  timeoutMs?: number
}

/** Mirrors byreal-cli token JSON (snake_case is the CLI's wire format, kept faithfully). */
export type ByrealTokenInfo = {
  mint: string
  symbol: string
  name: string
  decimals: number
  logo_uri?: string
  price_usd?: number
  price_change_24h?: number
  volume_24h_usd?: number
  multiplier?: string
}

/** Mirrors byreal-cli `pools list` item. */
export type ByrealPool = {
  id: string
  pair: string
  token_a: ByrealTokenInfo
  token_b: ByrealTokenInfo
  tvl_usd?: number
  volume_24h_usd?: number
  volume_7d_usd?: number
  fee_rate_bps?: number
  fee_24h_usd?: number
  apr?: number
  reward_apr?: number
  total_apr?: number
  current_price?: number
  price_change_1h?: number
  price_change_24h?: number
  price_change_7d?: number
}

/** Normalized swap quote (priceImpactPct parsed to number; the rest pass through). */
export type ByrealSwapQuote = {
  inputMint: string
  outputMint: string
  inAmount: string // raw base units
  outAmount: string // raw base units
  uiInAmount: string
  uiOutAmount: string
  priceImpactPct: number
  routerType: 'AMM' | 'RFQ'
  orderId?: string
  quoteId?: string
  poolAddresses?: string[]
  inAmountUsd?: string
  outAmountUsd?: string
}

/** Output of any `--unsigned-tx` build (swap or position). */
export type ByrealUnsignedTxResult = {
  /** base64-encoded Solana VersionedTransaction(s), ready for OWS to sign (C2). */
  unsignedTransactions: string[]
  /** Present for `positions open` — the position-NFT mint, already pre-signed by the CLI. */
  extraSignerPublicKey?: string
}

export type SwapMode = 'in' | 'out'

export type QuoteSwapParams = {
  inputMint: string
  outputMint: string
  /** UI amount (decimals auto-resolved by the CLI), e.g. "1.5". */
  amount: string
  swapMode?: SwapMode
  slippageBps?: number
  /** Optional owner pubkey; improves the quote and is required to build a tx. */
  ownerPubkey?: string
}

export type BuildSwapParams = QuoteSwapParams & { ownerPubkey: string }

export class ByrealCliError extends Error {
  constructor(
    message: string,
    readonly details?: { stdout?: string; stderr?: string; code?: number | string; args?: string[] },
  ) {
    super(message)
    this.name = 'ByrealCliError'
  }
}

export class ByrealClient {
  private readonly bin: string
  private readonly timeoutMs: number
  private readonly env: NodeJS.ProcessEnv

  constructor(config: ByrealClientConfig = {}) {
    this.bin = config.bin ?? process.env.BYREAL_CLI_BIN ?? 'byreal-cli'
    this.timeoutMs = config.timeoutMs ?? 30_000
    this.env = {
      ...process.env,
      ...(config.apiUrl ? { BYREAL_API_URL: config.apiUrl } : {}),
      ...(config.rpcUrl ? { SOLANA_RPC_URL: config.rpcUrl } : {}),
    }
  }

  // ---------------------------------------------------------------------------
  // Read-only (keyless, public mainnet API)
  // ---------------------------------------------------------------------------

  async listPools(opts: {
    sortField?: 'tvl' | 'volumeUsd24h' | 'feeUsd24h' | 'apr24h'
    sortType?: 'asc' | 'desc'
    pageSize?: number
    page?: number
    category?: number
  } = {}): Promise<ByrealPool[]> {
    const args = ['pools', 'list']
    if (opts.sortField) args.push('--sort-field', opts.sortField)
    if (opts.sortType) args.push('--sort-type', opts.sortType)
    if (opts.pageSize != null) args.push('--page-size', String(opts.pageSize))
    if (opts.page != null) args.push('--page', String(opts.page))
    if (opts.category != null) args.push('--category', String(opts.category))
    const data = await this.runEnveloped<{ pools: ByrealPool[] }>(args)
    return data.pools ?? []
  }

  async listTokens(): Promise<ByrealTokenInfo[]> {
    const data = await this.runEnveloped<{ tokens: ByrealTokenInfo[] }>(['tokens', 'list'])
    return data.tokens ?? []
  }

  async quoteSwap(p: QuoteSwapParams): Promise<ByrealSwapQuote> {
    const args = this.swapArgs(p, '--dry-run')
    const data = await this.runEnveloped<RawSwapData>(args)
    return normalizeQuote(data)
  }

  // ---------------------------------------------------------------------------
  // Build unsigned (keyless; owner = OWS wallet pubkey). OWS signs in C2.
  // ---------------------------------------------------------------------------

  async buildSwapUnsigned(
    p: BuildSwapParams,
  ): Promise<ByrealUnsignedTxResult & { quote: ByrealSwapQuote }> {
    const quote = await this.quoteSwap(p)
    const args = this.swapArgs(p, '--unsigned-tx', '--wallet-address', p.ownerPubkey)
    const unsigned = await this.runRaw<ByrealUnsignedTxResult>(args)
    if (!unsigned.unsignedTransactions?.length) {
      throw new ByrealCliError('byreal-cli returned no unsigned transaction', { args })
    }
    return { ...unsigned, quote }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private swapArgs(p: QuoteSwapParams, ...extra: string[]): string[] {
    const args = [
      'swap',
      'execute',
      ...extra,
      '--input-mint',
      p.inputMint,
      '--output-mint',
      p.outputMint,
      '--amount',
      p.amount,
    ]
    if (p.swapMode) args.push('--swap-mode', p.swapMode)
    if (p.slippageBps != null) args.push('--slippage', String(p.slippageBps))
    if (p.ownerPubkey && !extra.includes('--wallet-address')) {
      args.push('--wallet-address', p.ownerPubkey)
    }
    return args
  }

  /** Run a command whose JSON is wrapped in the `{ success, meta, data }` envelope. */
  private async runEnveloped<T>(args: string[]): Promise<T> {
    const json = await this.exec(args)
    if (json && typeof json === 'object' && 'success' in json) {
      const env = json as { success?: boolean; data?: T; error?: unknown }
      if (env.success === false) {
        throw new ByrealCliError(`byreal-cli ${args.join(' ')} failed: ${JSON.stringify(env.error)}`, { args })
      }
      if (env.data !== undefined) return env.data
    }
    throw new ByrealCliError(`byreal-cli ${args.join(' ')} returned no data envelope`, { args })
  }

  /** Run a command whose JSON is emitted raw (no envelope), e.g. `--unsigned-tx`. */
  private async runRaw<T>(args: string[]): Promise<T> {
    return (await this.exec(args)) as T
  }

  /** Spawn the CLI with `-o json`, then extract and parse the first JSON object in stdout. */
  private async exec(args: string[]): Promise<unknown> {
    const fullArgs = [...args, '-o', 'json']
    let stdout: string
    try {
      const res = await execFile(this.bin, fullArgs, {
        env: this.env,
        timeout: this.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      })
      stdout = res.stdout
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number | string; message?: string }
      // Some failures still print a JSON error envelope to stdout — surface it if present.
      const parsed = err.stdout ? tryExtractJson(err.stdout) : undefined
      const detail = parsed ? JSON.stringify((parsed as { error?: unknown }).error ?? parsed) : err.stderr?.trim()
      throw new ByrealCliError(
        `byreal-cli ${args.join(' ')} exited (${err.code ?? '?'})${detail ? `: ${detail}` : ''}`,
        { stdout: err.stdout, stderr: err.stderr, code: err.code, args: fullArgs },
      )
    }
    const json = tryExtractJson(stdout)
    if (json === undefined) {
      throw new ByrealCliError(`byreal-cli ${args.join(' ')} produced no parseable JSON`, { stdout, args: fullArgs })
    }
    return json
  }
}

type RawSwapData = {
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  uiInAmount: string
  uiOutAmount: string
  priceImpactPct?: string | number
  routerType?: string
  orderId?: string
  quoteId?: string
  poolAddresses?: string[]
  inAmountUsd?: string
  outAmountUsd?: string
}

function normalizeQuote(d: RawSwapData): ByrealSwapQuote {
  return {
    inputMint: d.inputMint,
    outputMint: d.outputMint,
    inAmount: d.inAmount,
    outAmount: d.outAmount,
    uiInAmount: d.uiInAmount,
    uiOutAmount: d.uiOutAmount,
    priceImpactPct: typeof d.priceImpactPct === 'string' ? Number(d.priceImpactPct) : d.priceImpactPct ?? 0,
    routerType: d.routerType === 'RFQ' ? 'RFQ' : 'AMM',
    orderId: d.orderId,
    quoteId: d.quoteId,
    poolAddresses: d.poolAddresses,
    inAmountUsd: d.inAmountUsd,
    outAmountUsd: d.outAmountUsd,
  }
}

/**
 * Extract the first balanced JSON object from CLI stdout, tolerating leading noise such as the
 * `[DRY RUN] ...` banner that precedes the JSON in dry-run mode.
 */
function tryExtractJson(stdout: string): unknown {
  const start = stdout.indexOf('{')
  if (start < 0) return undefined
  try {
    return JSON.parse(stdout.slice(start))
  } catch {
    return undefined
  }
}

export function createByrealClient(config?: ByrealClientConfig): ByrealClient {
  return new ByrealClient(config)
}
