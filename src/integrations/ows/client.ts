import {
  createApiKey,
  createWallet,
  getWallet,
  importWalletPrivateKey,
  listWallets,
  signTransaction,
  signMessage,
  type ApiKeyResult,
  type WalletInfo,
} from '@open-wallet-standard/core'
import { Connection, PublicKey, type Transaction } from '@solana/web3.js'
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
      }
    }

    const wallet =
      input.importPrivateKey != null
        ? importWalletPrivateKey(
            input.name,
            normalizePrivateKeyForImport(input.importPrivateKey, input.importChain),
            this.config.passphrase,
            this.config.vaultPath,
            input.importChain ?? 'evm',
          )
        : createWallet(
            input.name,
            this.config.passphrase,
            12,
            this.config.vaultPath,
          )

    return {
      wallet,
      evmAddress: readEvmAddress(wallet),
      solanaAddress: readSolanaAddress(wallet),
      importedFromPrivateKey: input.importPrivateKey != null,
    }
  }

  getWallet(nameOrId: string): WalletInfo {
    return getWallet(nameOrId, this.config.vaultPath)
  }

  getSolanaAddress(nameOrId: string): string | undefined {
    return readSolanaAddress(this.getWallet(nameOrId))
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
