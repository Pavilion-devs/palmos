import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import {
  PUSD_TOKEN_PROGRAM_ID,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_LOCAL_CHAIN_ID,
  type SolanaCluster,
} from '../integrations/pusd/constants.js'
import type {
  PaidCallPaymentRail,
  PaidCallSettlementMode,
  PaidCallSettlementRecord,
} from '../store/PaidCallRegistry.js'

export function buildSolscanTransactionUrl(
  signature: string | undefined,
  chainId: string | undefined,
): string | undefined {
  const solanaSignaturePattern = /^[1-9A-HJ-NP-Za-km-z]+$/
  if (
    !signature ||
    signature.length < 80 ||
    !solanaSignaturePattern.test(signature) ||
    chainId === SOLANA_LOCAL_CHAIN_ID
  ) {
    return undefined
  }

  const cluster = chainId === SOLANA_DEVNET_CHAIN_ID ? '?cluster=devnet' : ''
  return `https://solscan.io/tx/${signature}${cluster}`
}

function readPusdTokenAccount(input: {
  owner?: string
  mint?: string
}): string | undefined {
  if (!input.owner || !input.mint) {
    return undefined
  }

  try {
    return getAssociatedTokenAddressSync(
      new PublicKey(input.mint),
      new PublicKey(input.owner),
      true,
      new PublicKey(PUSD_TOKEN_PROGRAM_ID),
    ).toBase58()
  } catch {
    return undefined
  }
}

function readSettlementSource(input: {
  rail: PaidCallPaymentRail
  mode?: PaidCallSettlementMode | 'x402'
}): PaidCallSettlementRecord['source'] {
  if (input.rail === 'x402') {
    return 'x402'
  }
  if (input.rail === 'umbra') {
    return 'umbra'
  }
  if (
    input.mode === 'local-demo' ||
    input.mode === 'real-solana' ||
    input.mode === 'ows'
  ) {
    return input.mode
  }

  return 'unknown'
}

function readConfirmationStatus(input: {
  source: PaidCallSettlementRecord['source']
  signature?: string
  failed?: boolean
}): PaidCallSettlementRecord['confirmationStatus'] {
  if (input.failed) {
    return 'failed'
  }
  if (input.source === 'local-demo') {
    return 'not_applicable'
  }
  if (input.signature) {
    return 'confirmed'
  }

  return 'unknown'
}

export function buildPaidCallSettlementRecord(input: {
  rail: PaidCallPaymentRail
  mode?: PaidCallSettlementMode | 'x402'
  amount: string
  assetSymbol: string
  network?: string
  mint?: string
  payer?: string
  recipient?: string
  reference?: string
  signature?: string
  explorerUrl?: string
  confirmedAt?: string
  failed?: boolean
}): PaidCallSettlementRecord {
  const source = readSettlementSource({
    rail: input.rail,
    mode: input.mode,
  })

  return {
    rail: input.rail,
    mode: input.mode,
    source,
    amount: input.amount,
    assetSymbol: input.assetSymbol,
    network: input.network,
    mint: input.mint,
    payer: input.payer,
    payerTokenAccount: readPusdTokenAccount({
      owner: input.payer,
      mint: input.mint,
    }),
    recipient: input.recipient,
    recipientTokenAccount: readPusdTokenAccount({
      owner: input.recipient,
      mint: input.mint,
    }),
    reference: input.reference,
    signature: input.signature,
    explorerUrl: input.explorerUrl,
    confirmationStatus: readConfirmationStatus({
      source,
      signature: input.signature,
      failed: input.failed,
    }),
    confirmedAt: input.signature && !input.failed ? input.confirmedAt : undefined,
    reconciliationStatus: source === 'local-demo' ? 'not_applicable' : undefined,
  }
}

export function toSolanaCluster(chainId: string): SolanaCluster | undefined {
  if (
    chainId === 'solana-mainnet' ||
    chainId === SOLANA_DEVNET_CHAIN_ID ||
    chainId === SOLANA_LOCAL_CHAIN_ID
  ) {
    return chainId
  }

  return undefined
}
