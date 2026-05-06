import { createHash } from 'crypto'
import type {
  ResolvedTransferSourceWallet,
  WalletProvider,
  WalletProviderResolutionInput,
  WalletRecord,
} from '../contracts/wallet.js'
import { defaultNow } from '../runtime/types.js'
import {
  InMemoryWalletRegistry,
  type WalletRegistry,
} from './WalletRegistry.js'

type DeterministicWalletProviderDependencies = {
  now?: () => string
  registry?: WalletRegistry
  wallets?: WalletRecord[]
}

function buildDeterministicAddress(walletId: string): string {
  return `0x${createHash('sha256')
    .update(walletId)
    .digest('hex')
    .slice(0, 40)}`
}

export class DeterministicWalletProvider implements WalletProvider {
  private readonly now: () => string
  private readonly registry: WalletRegistry

  constructor(dependencies: DeterministicWalletProviderDependencies = {}) {
    this.now = dependencies.now ?? defaultNow
    this.registry =
      dependencies.registry ??
      new InMemoryWalletRegistry(dependencies.wallets ?? [])
  }

  async registerWallet(wallet: WalletRecord): Promise<void> {
    await this.registry.put(wallet)
  }

  async resolveTransferSource(
    input: WalletProviderResolutionInput,
  ): Promise<ResolvedTransferSourceWallet> {
    const existingWallet = await this.registry.get(input.walletId)
    const supportedChains = existingWallet?.supportedChains ?? [input.chainId]

    if (!supportedChains.includes(input.chainId)) {
      throw new Error(
        `Wallet ${input.walletId} does not support chain ${input.chainId}.`,
      )
    }

    const signerClass =
      input.requiredSignerClass ??
      input.allowedSignerClasses?.[0] ??
      'mpc'
    const signerProfileId =
      existingWallet?.signerProfileId ?? `${signerClass}_default`

    const wallet: WalletRecord =
      existingWallet ?? {
        walletId: input.walletId,
        createdAt: this.now(),
        updatedAt: this.now(),
        state: 'active_full',
        walletType: 'ops',
        address: buildDeterministicAddress(input.walletId),
        supportedChains,
        signerProfileId,
        providerId: 'deterministic_wallet_provider',
        complianceStatus: 'approved',
        policyAttachmentStatus: 'attached',
        signerHealthStatus: 'healthy',
        trustStatus: 'sufficient',
      }

    if (!existingWallet) {
      await this.registry.put(wallet)
    }

    return {
      providerId: wallet.providerId ?? 'deterministic_wallet_provider',
      wallet,
      address: wallet.address ?? buildDeterministicAddress(wallet.walletId),
      signerProfileId,
      signerClass,
      supportedChains,
    }
  }
}
