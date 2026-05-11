import {
  createInMemorySigner,
  createSignerFromPrivateKeyBytes,
  getUmbraClient,
} from '@umbra-privacy/sdk'
import type {
  ResolvedTransferSourceWallet,
  WalletProvider,
  WalletProviderResolutionInput,
} from '../../../runtime/index.js'
import {
  InMemoryWalletRegistry,
  type WalletRegistry,
} from '../../../runtime/index.js'
import {
  defaultUmbraIndexerApiEndpoint,
  type UmbraNetwork,
} from './constants.js'

export type UmbraClient = Awaited<ReturnType<typeof getUmbraClient>>
export type UmbraSigner = Parameters<typeof getUmbraClient>[0]['signer']

export type UmbraWalletProviderDependencies = {
  network?: UmbraNetwork
  rpcUrl?: string
  rpcSubscriptionsUrl?: string
  indexerApiEndpoint?: string
  secretKeyBase64?: string
  signer?: UmbraSigner
  client?: UmbraClient
  registry?: WalletRegistry
  defaultSignerProfileId?: string
  deferMasterSeedSignature?: boolean
}

export class UmbraWalletProvider implements WalletProvider {
  private readonly registry: WalletRegistry
  private readonly defaultSignerProfileId: string | undefined
  private readonly clientPromise: Promise<UmbraClient>

  private constructor(
    clientPromise: Promise<UmbraClient>,
    deps: UmbraWalletProviderDependencies,
  ) {
    this.clientPromise = clientPromise
    this.registry = deps.registry ?? new InMemoryWalletRegistry()
    this.defaultSignerProfileId = deps.defaultSignerProfileId
  }

  static async create(
    deps: UmbraWalletProviderDependencies = {},
  ): Promise<UmbraWalletProvider> {
    if (deps.client) {
      return new UmbraWalletProvider(Promise.resolve(deps.client), deps)
    }

    const network = deps.network ?? 'devnet'
    const signer = await buildUmbraSigner(deps)
    const indexerApiEndpoint =
      deps.indexerApiEndpoint ?? defaultUmbraIndexerApiEndpoint(network)

    const clientPromise = getUmbraClient({
      signer,
      network,
      rpcUrl: deps.rpcUrl ?? defaultRpcUrl(network),
      rpcSubscriptionsUrl: deps.rpcSubscriptionsUrl ?? defaultWsUrl(network),
      ...(indexerApiEndpoint ? { indexerApiEndpoint } : {}),
      ...(deps.deferMasterSeedSignature !== undefined
        ? { deferMasterSeedSignature: deps.deferMasterSeedSignature }
        : {}),
    })

    return new UmbraWalletProvider(clientPromise, deps)
  }

  async getClient(): Promise<UmbraClient> {
    return this.clientPromise
  }

  async resolveTransferSource(
    input: WalletProviderResolutionInput,
  ): Promise<ResolvedTransferSourceWallet> {
    const wallet = await this.registry.get(input.walletId)
    if (!wallet) {
      throw new Error(
        `UmbraWalletProvider: wallet ${input.walletId} is not registered.`,
      )
    }

    const client = await this.clientPromise
    const signerClass =
      input.requiredSignerClass ?? input.allowedSignerClasses?.[0] ?? 'mpc'

    return {
      providerId: 'umbra_wallet_provider',
      wallet: {
        ...wallet,
        address: String(client.signer.address),
      },
      address: String(client.signer.address),
      signerProfileId:
        wallet.signerProfileId ?? this.defaultSignerProfileId ?? 'mpc_default',
      signerClass,
      supportedChains: wallet.supportedChains ?? ['solana-devnet'],
    }
  }
}

async function buildUmbraSigner(
  deps: UmbraWalletProviderDependencies,
): Promise<UmbraSigner> {
  if (deps.signer) {
    return deps.signer
  }

  if (deps.secretKeyBase64) {
    return createSignerFromPrivateKeyBytes(
      new Uint8Array(Buffer.from(deps.secretKeyBase64, 'base64')),
    )
  }

  return createInMemorySigner()
}

function defaultRpcUrl(network: UmbraNetwork): string {
  switch (network) {
    case 'mainnet':
      return 'https://api.mainnet-beta.solana.com'
    case 'localnet':
      return 'http://127.0.0.1:8899'
    case 'devnet':
      return 'https://api.devnet.solana.com'
  }
}

function defaultWsUrl(network: UmbraNetwork): string {
  switch (network) {
    case 'mainnet':
      return 'wss://api.mainnet-beta.solana.com'
    case 'localnet':
      return 'ws://127.0.0.1:8900'
    case 'devnet':
      return 'wss://api.devnet.solana.com'
  }
}
