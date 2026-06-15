import {
  createApiKey,
  createWallet,
  exportWallet,
  getWallet,
  importWalletPrivateKey,
  listWallets,
  signTransaction,
  signMessage,
  signHash,
  type ApiKeyResult,
  type WalletInfo,
} from '@open-wallet-standard/core'
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import nacl from 'tweetnacl'
import { mkdir } from 'fs/promises'
import { execFile as execFileCallback } from 'child_process'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import type { PusdPaymentRequiredResponse } from '../pusd/paymentInstructions.js'
import { readSolanaKeypairFromPrivateKey } from '../pusd/keypair.js'
import { buildUnsignedPusdPaymentTransaction } from '../pusd/transfer.js'
import {
  checkPusdPaymentReadiness,
  formatPusdReadinessFailure,
} from '../pusd/readiness.js'
import { readSolanaRpcUrlFromEnv } from '../pusd/constants.js'

const execFile = promisify(execFileCallback)
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const OWS_BIN_PATH = join(PACKAGE_ROOT, 'node_modules', '.bin', 'ows')

export type OwsClientConfig = {
  enabled: boolean
  homeDir: string
  vaultPath: string
  passphrase: string
}

export type OwsWalletBinding = {
  wallet: WalletInfo
  evmAddress?: string
  solanaAddress?: string
  importedFromPrivateKey: boolean
  /** True when this call CREATED the wallet (vs. returning an existing one). */
  created?: boolean
  /**
   * Recovery phrase for a freshly-created (non-imported) wallet — present ONCE, only at creation,
   * so the operator/user can back it up. It is NOT stored anywhere new; it already lives (encrypted)
   * in the vault. Never surfaced for existing or imported wallets. Treat as a one-time secret.
   */
  recoveryPhrase?: string
}

export type OwsPayRequestResult = {
  stdout: string
  parsedBody?: unknown
}

export type OwsSolanaPaymentResult = {
  stdout: string
  parsedBody?: unknown
  signature?: string
}

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

function readEvmAddress(wallet: WalletInfo): string | undefined {
  return wallet.accounts.find((account) => account.chainId.startsWith('eip155:'))
    ?.address
}

function readSolanaAddress(wallet: WalletInfo): string | undefined {
  return wallet.accounts.find((account) => account.chainId.startsWith('solana:'))
    ?.address
}

function parseOwsSignature(stdout: string): {
  signature?: string
  parsedBody?: unknown
} {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return {}
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>
      const signature =
        typeof record.signature === 'string'
          ? record.signature
          : typeof record.txid === 'string'
            ? record.txid
            : typeof record.transactionHash === 'string'
              ? record.transactionHash
              : undefined
      return {
        signature,
        parsedBody: parsed,
      }
    }
  } catch {
    return {
      signature: trimmed,
    }
  }

  return {
    signature: trimmed,
  }
}

function transactionToUnsignedHex(transaction: Transaction): string {
  return transaction
    .serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })
    .toString('hex')
}

function normalizePrivateKeyForImport(
  value: string,
  chain: string | undefined,
): string {
  if (chain !== 'solana') {
    return value
  }

  const keypair = readSolanaKeypairFromPrivateKey(value)
  return Buffer.from(keypair.secretKey.slice(0, 32)).toString('hex')
}

export function readOwsConfigFromEnv(
  baseDir: string,
  env: Record<string, string | undefined> = readProcessEnv(),
): OwsClientConfig {
  const homeDir = env.OWS_HOME?.trim() || join(baseDir, 'ows-home')
  const vaultPath = env.OWS_VAULT_PATH?.trim() || join(homeDir, '.ows')

  return {
    enabled: env.OWS_ENABLED !== '0',
    homeDir,
    vaultPath,
    passphrase: env.OWS_PASSPHRASE?.trim() || '',
  }
}

export class OwsClient {
  constructor(private readonly config: OwsClientConfig) {}

  static fromEnv(
    baseDir: string,
    env: Record<string, string | undefined> = readProcessEnv(),
  ): OwsClient | undefined {
    const config = readOwsConfigFromEnv(baseDir, env)
    return config.enabled ? new OwsClient(config) : undefined
  }

  get vaultPath(): string {
    return this.config.vaultPath
  }

  get homeDir(): string {
    return this.config.homeDir
  }

  private async ensureHome(): Promise<void> {
    await mkdir(this.config.homeDir, { recursive: true })
    await mkdir(this.config.vaultPath, { recursive: true })
  }

  async ensureWallet(input: {
    name: string
    importPrivateKey?: string
    importChain?: string
  }): Promise<OwsWalletBinding> {
    await this.ensureHome()
    const existing = listWallets(this.config.vaultPath).find(
      (wallet) => wallet.name === input.name,
    )
    if (existing) {
      return {
        wallet: existing,
        evmAddress: readEvmAddress(existing),
        solanaAddress: readSolanaAddress(existing),
        importedFromPrivateKey: false,
        created: false,
      }
    }

    const isImport = input.importPrivateKey != null
    const wallet = isImport
      ? importWalletPrivateKey(
          input.name,
          normalizePrivateKeyForImport(input.importPrivateKey!, input.importChain),
          this.config.passphrase,
          this.config.vaultPath,
          input.importChain ?? 'evm',
        )
      : createWallet(input.name, this.config.passphrase, 12, this.config.vaultPath)

    // Export the recovery phrase ONCE for a freshly-created wallet so it can be backed up. Imported
    // wallets already have their key with the user, so no phrase is surfaced. Read-only: it doesn't
    // store anything new (the seed already lives encrypted in the vault).
    let recoveryPhrase: string | undefined
    if (!isImport) {
      try {
        recoveryPhrase = exportWallet(input.name, this.config.passphrase, this.config.vaultPath)
      } catch {
        recoveryPhrase = undefined
      }
    }

    return {
      wallet,
      evmAddress: readEvmAddress(wallet),
      solanaAddress: readSolanaAddress(wallet),
      importedFromPrivateKey: isImport,
      created: true,
      recoveryPhrase,
    }
  }

  getWallet(nameOrId: string): WalletInfo {
    return getWallet(nameOrId, this.config.vaultPath)
  }

  getSolanaAddress(nameOrId: string): string | undefined {
    return readSolanaAddress(this.getWallet(nameOrId))
  }

  // The wallet's EVM (eip155, secp256k1 @ m/44'/60'/0'/0/0) address — the SAME vault that signs
  // this agent's Solana txns. This is what ties the Mantle ERC-8004 identity + decision log to the
  // OWS custody: "one agent, one vault, two chains".
  getEvmAddress(nameOrId: string): string | undefined {
    return readEvmAddress(this.getWallet(nameOrId))
  }

  // Sign a 32-byte hash with the wallet's EVM (secp256k1) key. Returns the raw r||s signature hex
  // plus the recovery id. This is the signing primitive the Mantle viem account bridges to:
  // viem builds an EVM tx, we keccak256 it, OWS signs the hash here, viem re-attaches {r,s,yParity}.
  // Proven in scripts/spike-e-ows-evm-sign.ts (sign → recover → matches the eip155 address).
  signEvmHash(
    walletNameOrId: string,
    hashHex: string,
  ): { signature: string; recoveryId: number } {
    const hex = hashHex.startsWith('0x') ? hashHex.slice(2) : hashHex
    const result = signHash(
      walletNameOrId,
      'ethereum',
      hex,
      this.config.passphrase,
      0,
      this.config.vaultPath,
    )
    return { signature: result.signature, recoveryId: result.recoveryId ?? 0 }
  }

  signMessage(walletNameOrId: string, chain: string, message: string) {
    return signMessage(
      walletNameOrId,
      chain,
      message,
      this.config.passphrase,
      'utf8',
      0,
      this.config.vaultPath,
    )
  }

  createApiKey(input: {
    name: string
    walletIds: string[]
    policyIds?: string[]
    expiresAt?: string
  }): ApiKeyResult {
    return createApiKey(
      input.name,
      input.walletIds,
      input.policyIds ?? [],
      this.config.passphrase,
      input.expiresAt,
      this.config.vaultPath,
    )
  }

  supportsPaymentChain(chainId: string): boolean {
    return (
      chainId === 'base' ||
      chainId === 'eip155:8453' ||
      chainId.includes('solana')
    )
  }

  async payPusdRequest(input: {
    wallet: string
    payment: PusdPaymentRequiredResponse
    rpcUrl?: string
  }): Promise<OwsSolanaPaymentResult> {
    await this.ensureHome()
    const rpcUrl = input.rpcUrl?.trim() || readSolanaRpcUrlFromEnv()
    const wallet = this.getWallet(input.wallet)
    const solanaAddress = readSolanaAddress(wallet)
    if (!solanaAddress) {
      throw new Error(`OWS wallet ${input.wallet} has no Solana account.`)
    }
    const readiness = await checkPusdPaymentReadiness({
      payer: solanaAddress,
      recipient: input.payment.recipient,
      amount: input.payment.amount,
      mint: input.payment.mint,
      rpcUrl,
    })
    if (!readiness.ok) {
      throw new Error(
        `OWS wallet ${input.wallet} is not ready for PUSD payment. ${formatPusdReadinessFailure(readiness)}`,
      )
    }

    const transaction = await buildUnsignedPusdPaymentTransaction({
      payment: input.payment,
      payer: new PublicKey(solanaAddress),
      rpcUrl,
    })
    const signed = signTransaction(
      input.wallet,
      'solana',
      transactionToUnsignedHex(transaction),
      this.config.passphrase,
      0,
      this.config.vaultPath,
    )
    const signatureHex = signed.signature.startsWith('0x')
      ? signed.signature.slice(2)
      : signed.signature
    const signature = Buffer.from(signatureHex, 'hex')

    transaction.addSignature(new PublicKey(solanaAddress), signature)
    if (!transaction.verifySignatures()) {
      throw new Error('OWS returned an invalid Solana transaction signature.')
    }

    const connection = new Connection(rpcUrl, 'confirmed')
    const transactionSignature = await connection.sendRawTransaction(
      transaction.serialize(),
    )
    await connection.confirmTransaction(transactionSignature, 'confirmed')

    return {
      stdout: JSON.stringify({ signature: transactionSignature }),
      parsedBody: {
        signature: transactionSignature,
      },
      signature: transactionSignature,
    }
  }

  // Build, OWS-sign, and broadcast a NATIVE SOL transfer on the configured
  // Solana cluster (devnet/mainnet/local via PUSD_SOLANA_NETWORK / rpcUrl). This
  // is the real settlement backend for approved native asset.transfer actions —
  // it is not network-specific, so it works on mainnet exactly as on devnet.
  async paySolanaTransfer(input: {
    wallet: string
    destination: string
    lamports: number
    rpcUrl?: string
  }): Promise<OwsSolanaPaymentResult> {
    await this.ensureHome()
    const rpcUrl = input.rpcUrl?.trim() || readSolanaRpcUrlFromEnv()
    const wallet = this.getWallet(input.wallet)
    const solanaAddress = readSolanaAddress(wallet)
    if (!solanaAddress) {
      throw new Error(`OWS wallet ${input.wallet} has no Solana account.`)
    }
    if (!Number.isFinite(input.lamports) || input.lamports <= 0) {
      throw new Error(
        `Invalid lamports amount for OWS Solana transfer: ${input.lamports}.`,
      )
    }

    const connection = new Connection(rpcUrl, 'confirmed')
    const fromPubkey = new PublicKey(solanaAddress)
    const toPubkey = new PublicKey(input.destination)
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash('confirmed')
    const transaction = new Transaction({
      feePayer: fromPubkey,
      blockhash,
      lastValidBlockHeight,
    })
    transaction.add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports: Math.round(input.lamports),
      }),
    )

    const signed = signTransaction(
      input.wallet,
      'solana',
      transactionToUnsignedHex(transaction),
      this.config.passphrase,
      0,
      this.config.vaultPath,
    )
    const signatureHex = signed.signature.startsWith('0x')
      ? signed.signature.slice(2)
      : signed.signature
    transaction.addSignature(fromPubkey, Buffer.from(signatureHex, 'hex'))
    if (!transaction.verifySignatures()) {
      throw new Error('OWS returned an invalid Solana transaction signature.')
    }

    const transactionSignature = await connection.sendRawTransaction(
      transaction.serialize(),
    )
    await connection.confirmTransaction(
      { signature: transactionSignature, blockhash, lastValidBlockHeight },
      'confirmed',
    )

    return {
      stdout: JSON.stringify({ signature: transactionSignature }),
      parsedBody: { signature: transactionSignature },
      signature: transactionSignature,
    }
  }

  // Sign an externally-built Solana transaction (e.g. a Byreal swap/LP tx produced
  // by `byreal-cli --unsigned-tx`) with the OWS vault and broadcast it. This is C2
  // of the Byreal integration: "Byreal proposes the tx, OWS signs it" — the vault
  // key never leaves custody. `base64Tx` is a (possibly partially-signed, e.g. a
  // position-NFT-mint co-signature) VersionedTransaction; we ONLY add the wallet
  // owner's signature and preserve any others. Spike 0 confirmed the OWS vault can
  // sign a VersionedTransaction's message. Network-agnostic — Byreal targets
  // Solana mainnet. Pass `skipBroadcast` to sign + integrity-check only (no send).
  async signAndBroadcastSolanaTx(input: {
    wallet: string
    base64Tx: string
    rpcUrl?: string
    skipBroadcast?: boolean
  }): Promise<OwsSolanaPaymentResult & { signedBase64: string }> {
    await this.ensureHome()
    const rpcUrl = input.rpcUrl?.trim() || readSolanaRpcUrlFromEnv()
    const wallet = this.getWallet(input.wallet)
    const solanaAddress = readSolanaAddress(wallet)
    if (!solanaAddress) {
      throw new Error(`OWS wallet ${input.wallet} has no Solana account.`)
    }
    const ownerPubkey = new PublicKey(solanaAddress)

    const transaction = VersionedTransaction.deserialize(
      new Uint8Array(Buffer.from(input.base64Tx, 'base64')),
    )

    // OWS signs the unsigned, serialized transaction hex (same primitive the
    // transfer paths use); we then attach the returned signature to the owner slot.
    const unsignedHex = Buffer.from(transaction.serialize()).toString('hex')
    const signed = signTransaction(
      input.wallet,
      'solana',
      unsignedHex,
      this.config.passphrase,
      0,
      this.config.vaultPath,
    )
    const signatureHex = signed.signature.startsWith('0x')
      ? signed.signature.slice(2)
      : signed.signature
    const signatureBytes = new Uint8Array(Buffer.from(signatureHex, 'hex'))
    transaction.addSignature(ownerPubkey, signatureBytes)

    // VersionedTransaction has no verifySignatures() in web3.js v1 — verify the
    // owner signature we just produced over the message bytes (tweetnacl).
    const validOwnerSignature = nacl.sign.detached.verify(
      transaction.message.serialize(),
      signatureBytes,
      ownerPubkey.toBytes(),
    )
    if (!validOwnerSignature) {
      throw new Error('OWS produced an invalid signature for the externally-built transaction.')
    }

    const signedBase64 = Buffer.from(transaction.serialize()).toString('base64')

    if (input.skipBroadcast) {
      return {
        stdout: JSON.stringify({ signed: true }),
        parsedBody: { signed: true },
        signedBase64,
      }
    }

    const connection = new Connection(rpcUrl, 'confirmed')
    const transactionSignature = await connection.sendRawTransaction(
      transaction.serialize(),
    )
    await connection.confirmTransaction(transactionSignature, 'confirmed')

    return {
      stdout: JSON.stringify({ signature: transactionSignature }),
      parsedBody: { signature: transactionSignature },
      signature: transactionSignature,
      signedBase64,
    }
  }

  // Build, OWS-sign, and broadcast a real SPL token transfer (transfer-checked,
  // creating the recipient's associated token account if needed) on the
  // configured Solana cluster. The mint/decimals/token-program are resolved by
  // the caller per asset (USDC = classic Token program, PUSD = Token-2022), so
  // this is asset-agnostic. Network-agnostic — works on mainnet exactly as on
  // devnet. `amount` is already in integer base units.
  async paySplTransfer(input: {
    wallet: string
    destination: string
    amount: bigint
    mint: string
    decimals: number
    tokenProgramId: string
    rpcUrl?: string
  }): Promise<OwsSolanaPaymentResult> {
    await this.ensureHome()
    const rpcUrl = input.rpcUrl?.trim() || readSolanaRpcUrlFromEnv()
    const wallet = this.getWallet(input.wallet)
    const solanaAddress = readSolanaAddress(wallet)
    if (!solanaAddress) {
      throw new Error(`OWS wallet ${input.wallet} has no Solana account.`)
    }
    if (input.amount <= 0n) {
      throw new Error(
        `Invalid token amount for OWS SPL transfer: ${input.amount}.`,
      )
    }

    const connection = new Connection(rpcUrl, 'confirmed')
    const owner = new PublicKey(solanaAddress)
    const mint = new PublicKey(input.mint)
    const tokenProgramId = new PublicKey(input.tokenProgramId)
    const recipientOwner = new PublicKey(input.destination)
    const payerTokenAccount = await getAssociatedTokenAddress(
      mint,
      owner,
      false,
      tokenProgramId,
    )
    const recipientTokenAccount = await getAssociatedTokenAddress(
      mint,
      recipientOwner,
      false,
      tokenProgramId,
    )

    if (!(await connection.getAccountInfo(payerTokenAccount))) {
      throw new Error(
        `OWS wallet ${input.wallet} has no ${input.mint} token account to transfer from.`,
      )
    }

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash('confirmed')
    const transaction = new Transaction({
      feePayer: owner,
      blockhash,
      lastValidBlockHeight,
    })

    if (!(await connection.getAccountInfo(recipientTokenAccount))) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          owner,
          recipientTokenAccount,
          recipientOwner,
          mint,
          tokenProgramId,
        ),
      )
    }
    transaction.add(
      createTransferCheckedInstruction(
        payerTokenAccount,
        mint,
        recipientTokenAccount,
        owner,
        input.amount,
        input.decimals,
        [],
        tokenProgramId,
      ),
    )

    const signed = signTransaction(
      input.wallet,
      'solana',
      transactionToUnsignedHex(transaction),
      this.config.passphrase,
      0,
      this.config.vaultPath,
    )
    const signatureHex = signed.signature.startsWith('0x')
      ? signed.signature.slice(2)
      : signed.signature
    transaction.addSignature(owner, Buffer.from(signatureHex, 'hex'))
    if (!transaction.verifySignatures()) {
      throw new Error('OWS returned an invalid Solana transaction signature.')
    }

    const transactionSignature = await connection.sendRawTransaction(
      transaction.serialize(),
    )
    await connection.confirmTransaction(
      { signature: transactionSignature, blockhash, lastValidBlockHeight },
      'confirmed',
    )

    return {
      stdout: JSON.stringify({ signature: transactionSignature }),
      parsedBody: { signature: transactionSignature },
      signature: transactionSignature,
    }
  }

  async payRequest(input: {
    wallet: string
    url: string
    method?: string
    body?: string
  }): Promise<OwsPayRequestResult> {
    await this.ensureHome()
    const args = ['pay', 'request', '--wallet', input.wallet, input.url]

    if (input.method && input.method !== 'GET') {
      args.splice(args.length - 1, 0, '--method', input.method)
    }

    if (input.body) {
      args.splice(args.length - 1, 0, '--body', input.body)
    }

    if (!this.config.passphrase) {
      args.splice(args.length - 1, 0, '--no-passphrase')
    }

    const { stdout } = await execFile(OWS_BIN_PATH, args, {
      env: {
        ...process.env,
        HOME: this.config.homeDir,
      },
      cwd: PACKAGE_ROOT,
    })

    const trimmed = stdout.trim()
    if (!trimmed) {
      return {
        stdout,
      }
    }

    try {
      return {
        stdout,
        parsedBody: JSON.parse(trimmed),
      }
    } catch {
      return {
        stdout,
      }
    }
  }
}
