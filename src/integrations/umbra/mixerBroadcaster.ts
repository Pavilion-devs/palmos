import {
  getClaimableUtxoScannerFunction,
  getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction,
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction,
  getUmbraRelayer,
  getUserRegistrationFunction,
} from '@umbra-privacy/sdk'
import {
  getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver,
  getCreateReceiverClaimableUtxoFromEncryptedBalanceProver,
  getUserRegistrationProver,
} from '@umbra-privacy/web-zk-prover'
import type {
  BroadcastInput,
  BroadcastRecord,
  BroadcastRefreshInput,
  Broadcaster,
} from '../../../runtime/index.js'
import { defaultIdGenerator, defaultNow } from '../../../runtime/index.js'
import { toRawUmbraAmount } from './amount.js'
import {
  UMBRA_TOKEN_DECIMALS,
  defaultUmbraMintAddresses,
  defaultUmbraRelayerApiEndpoint,
  toSolanaChainId,
  type UmbraNetwork,
} from './constants.js'
import type { UmbraClient, UmbraWalletProvider } from './walletProvider.js'

export type UmbraMixerBroadcastRecord = BroadcastRecord & {
  privacyPath: 'umbra_mixer_utxo'
  fundingTransactionSignatures?: string[]
  createUtxoTransactionSignatures?: string[]
  claimTransactionSignatures?: string[]
}

export type UmbraMixerBroadcasterDependencies = {
  walletProvider?: UmbraWalletProvider
  client?: UmbraClient
  mintAddresses?: Record<string, string>
  network?: UmbraNetwork
  relayerApiEndpoint?: string
  fundEncryptedBalance?: boolean
  autoClaim?: boolean
  scanTreeIndex?: number
  scanStartIndex?: number
  scanLimit?: number
  scanAttempts?: number
  scanDelayMs?: number
  now?: () => string
  createId?: (prefix: string) => string
}

export class UmbraMixerBroadcaster implements Broadcaster {
  private readonly walletProvider: UmbraWalletProvider | undefined
  private readonly directClient: UmbraClient | undefined
  private readonly mintAddresses: Record<string, string>
  private readonly network: UmbraNetwork
  private readonly relayerApiEndpoint: string | undefined
  private readonly fundEncryptedBalance: boolean
  private readonly autoClaim: boolean
  private readonly scanTreeIndex: number
  private readonly scanStartIndex: number
  private readonly scanLimit: number
  private readonly scanAttempts: number
  private readonly scanDelayMs: number
  private readonly now: () => string
  private readonly createId: (prefix: string) => string

  constructor(deps: UmbraMixerBroadcasterDependencies = {}) {
    if (!deps.walletProvider && !deps.client) {
      throw new Error('UmbraMixerBroadcaster: supply walletProvider or client')
    }

    this.walletProvider = deps.walletProvider
    this.directClient = deps.client
    this.network = deps.network ?? 'devnet'
    this.mintAddresses = deps.mintAddresses ?? defaultUmbraMintAddresses(this.network)
    this.relayerApiEndpoint =
      deps.relayerApiEndpoint ?? defaultUmbraRelayerApiEndpoint(this.network)
    this.fundEncryptedBalance = deps.fundEncryptedBalance ?? true
    this.autoClaim = deps.autoClaim ?? true
    this.scanTreeIndex = deps.scanTreeIndex ?? 0
    this.scanStartIndex = deps.scanStartIndex ?? 0
    this.scanLimit = deps.scanLimit ?? 10_000
    this.scanAttempts = deps.scanAttempts ?? 6
    this.scanDelayMs = deps.scanDelayMs ?? 5_000
    this.now = deps.now ?? defaultNow
    this.createId = deps.createId ?? defaultIdGenerator
  }

  async broadcastSignedTransfer(
    input: BroadcastInput,
  ): Promise<UmbraMixerBroadcastRecord> {
    const client = await this.resolveClient()
    const network = toSolanaChainId(this.network)
    const { transactionEnvelope, signatureRequestId } = input.signatureRequest
    const movement =
      transactionEnvelope.tokenMovements.find(
        (candidate) => candidate.toAddress === transactionEnvelope.toAddress,
      ) ?? transactionEnvelope.tokenMovements[0]

    if (!movement) {
      return this.failedRecord(
        input.runId,
        signatureRequestId,
        network,
        'No token movement was present in the signature request.',
      )
    }

    const mint = this.mintAddresses[movement.assetSymbol]
    if (!mint) {
      return this.failedRecord(
        input.runId,
        signatureRequestId,
        network,
        `Umbra mixer has no mint registered for ${movement.assetSymbol}.`,
      )
    }

    const rawAmount = toRawUmbraAmount(
      movement.amount,
      UMBRA_TOKEN_DECIMALS[movement.assetSymbol] ?? 6,
    )

    try {
      const register = getUserRegistrationFunction(
        { client },
        { zkProver: getUserRegistrationProver() },
      )
      await register({ confidential: true, anonymous: true })

      const fundingTransactionSignatures = this.fundEncryptedBalance
        ? await this.fundSenderEncryptedBalance(client, mint, rawAmount)
        : []

      const createUtxo = getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction(
        { client },
        { zkProver: getCreateReceiverClaimableUtxoFromEncryptedBalanceProver() },
      )
      const createResult = await createUtxo({
        amount: rawAmount,
        destinationAddress: transactionEnvelope.toAddress,
        mint,
      } as Parameters<typeof createUtxo>[0])
      const createUtxoTransactionSignatures = getCreateUtxoSignatures(createResult)

      if (!this.autoClaim) {
        const transactionHash =
          createUtxoTransactionSignatures.at(-1) ??
          createUtxoTransactionSignatures[0]

        return {
          broadcastId: this.createId('umbra_mixer_broadcast'),
          runId: input.runId,
          submittedAt: this.now(),
          status: 'submitted',
          privacyPath: 'umbra_mixer_utxo',
          transactionHash,
          network,
          signatureRequestId,
          fundingTransactionSignatures,
          createUtxoTransactionSignatures,
          summary:
            `Umbra ETA -> Mixer UTXO created for ${movement.amount} ${movement.assetSymbol}; receiver claim is pending.`,
        }
      }

      if (!this.relayerApiEndpoint) {
        return this.failedRecord(
          input.runId,
          signatureRequestId,
          network,
          'Umbra mixer auto-claim requires a relayer endpoint.',
        )
      }

      if (!client.fetchBatchMerkleProof) {
        return this.failedRecord(
          input.runId,
          signatureRequestId,
          network,
          'Umbra mixer auto-claim requires indexer support.',
        )
      }

      const receiverUtxos = await this.scanForReceiverUtxos(client)
      if (receiverUtxos.length === 0) {
        return {
          ...this.failedRecord(
            input.runId,
            signatureRequestId,
            network,
            `Umbra mixer UTXO was created, but no receiver-claimable UTXO was found after ${this.scanAttempts} scan attempt(s).`,
          ),
          fundingTransactionSignatures,
          createUtxoTransactionSignatures,
          transactionHash:
            createUtxoTransactionSignatures.at(-1) ??
            createUtxoTransactionSignatures[0],
        }
      }

      const relayer = getUmbraRelayer({ apiEndpoint: this.relayerApiEndpoint })
      const claim = getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction(
        { client },
        {
          zkProver: getClaimReceiverClaimableUtxoIntoEncryptedBalanceProver(),
          relayer,
          fetchBatchMerkleProof: client.fetchBatchMerkleProof,
        },
      )
      const claimResult = await claim(receiverUtxos as Parameters<typeof claim>[0])
      const claimTransactionSignatures = flattenClaimSignatures(claimResult)
      const transactionHash =
        claimTransactionSignatures.at(-1) ??
        createUtxoTransactionSignatures.at(-1) ??
        createUtxoTransactionSignatures[0]

      return {
        broadcastId: this.createId('umbra_mixer_broadcast'),
        runId: input.runId,
        submittedAt: this.now(),
        status: 'confirmed',
        privacyPath: 'umbra_mixer_utxo',
        transactionHash,
        network,
        signatureRequestId,
        fundingTransactionSignatures,
        createUtxoTransactionSignatures,
        claimTransactionSignatures,
        summary:
          `Umbra ETA -> Mixer -> ETA payment completed for ${movement.amount} ${movement.assetSymbol}.`,
      }
    } catch (error) {
      return this.failedRecord(
        input.runId,
        signatureRequestId,
        network,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async refreshBroadcast(
    input: BroadcastRefreshInput,
  ): Promise<UmbraMixerBroadcastRecord> {
    return {
      ...(input.record as UmbraMixerBroadcastRecord),
      status: input.record.status === 'submitted' ? 'submitted' : 'confirmed',
      privacyPath: 'umbra_mixer_utxo',
    }
  }

  private async scanForReceiverUtxos(client: UmbraClient): Promise<unknown[]> {
    const scan = getClaimableUtxoScannerFunction({ client })
    for (let attempt = 0; attempt < this.scanAttempts; attempt += 1) {
      const result = await scan(
        BigInt(this.scanTreeIndex) as Parameters<typeof scan>[0],
        BigInt(this.scanStartIndex) as Parameters<typeof scan>[1],
        BigInt(this.scanLimit) as Parameters<typeof scan>[2],
      )
      const received = Array.isArray(result.received) ? result.received : []
      if (received.length > 0) {
        return received
      }
      if (attempt < this.scanAttempts - 1) {
        await delay(this.scanDelayMs)
      }
    }
    return []
  }

  private async fundSenderEncryptedBalance(
    client: UmbraClient,
    mint: string,
    rawAmount: bigint,
  ): Promise<string[]> {
    const deposit = getPublicBalanceToEncryptedBalanceDirectDepositorFunction({
      client,
    })
    const result = await deposit(
      String(client.signer.address) as Parameters<typeof deposit>[0],
      mint as Parameters<typeof deposit>[1],
      rawAmount as Parameters<typeof deposit>[2],
    )
    return getDirectDepositSignatures(result)
  }

  private async resolveClient(): Promise<UmbraClient> {
    if (this.directClient) {
      return this.directClient
    }
    if (this.walletProvider) {
      return this.walletProvider.getClient()
    }
    throw new Error('UmbraMixerBroadcaster: no client is available')
  }

  private failedRecord(
    runId: string,
    signatureRequestId: string,
    network: string,
    summary: string,
  ): UmbraMixerBroadcastRecord {
    return {
      broadcastId: this.createId('umbra_mixer_broadcast'),
      runId,
      submittedAt: this.now(),
      status: 'failed',
      privacyPath: 'umbra_mixer_utxo',
      network,
      signatureRequestId,
      summary,
    }
  }
}

function flattenClaimSignatures(result: unknown): string[] {
  const batches = (result as { batches?: unknown }).batches
  if (batches instanceof Map) {
    return [...batches.values()]
      .flatMap((value) => [
        (value as { txSignature?: unknown }).txSignature,
        (value as { callbackSignature?: unknown }).callbackSignature,
      ])
      .filter((value): value is string => typeof value === 'string')
  }

  const signatures = (result as { signatures?: unknown }).signatures
  if (!signatures || typeof signatures !== 'object') {
    return []
  }
  return Object.values(signatures as Record<string, unknown>)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === 'string')
}

function getCreateUtxoSignatures(result: unknown): string[] {
  const record = result as Record<string, unknown>
  return [
    record.closeProofAccountSignature,
    record.createProofAccountSignature,
    record.queueSignature,
    record.callbackSignature,
    record.rentClaimSignature,
  ].filter((value): value is string => typeof value === 'string')
}

function getDirectDepositSignatures(result: unknown): string[] {
  const record = result as Record<string, unknown>
  return [record.queueSignature, record.callbackSignature].filter(
    (value): value is string => typeof value === 'string',
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
