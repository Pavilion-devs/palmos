import {
  Connection,
  PublicKey,
  type ParsedInstruction,
  type PartiallyDecodedInstruction,
} from '@solana/web3.js'
import type { PusdPaymentRequest } from './paymentInstructions.js'
import { parsePusdAmountToBaseUnits } from './amount.js'
import { readSolanaRpcUrlFromEnv } from './constants.js'

export type VerifyPusdPaymentInput = {
  signature: string
  request: PusdPaymentRequest
  rpcUrl?: string
  commitment?: 'confirmed' | 'finalized'
}

export type VerifyPusdPaymentResult =
  | {
      valid: true
      signature: string
      amountBaseUnits: string
    }
  | {
      valid: false
      signature: string
      reason: string
    }

function isParsedInstruction(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
): instruction is ParsedInstruction {
  return 'parsed' in instruction
}

function instructionHasReference(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
  reference: string,
): boolean {
  if (isParsedInstruction(instruction)) {
    if (instruction.program === 'spl-memo') {
      return String(instruction.parsed).includes(reference)
    }
    return JSON.stringify(instruction.parsed).includes(reference)
  }

  return false
}

function hasReferenceMemo(
  instructions: Array<ParsedInstruction | PartiallyDecodedInstruction>,
  reference: string,
): boolean {
  return instructions.some((instruction) =>
    instructionHasReference(instruction, reference),
  )
}

export async function verifyPusdPayment(
  input: VerifyPusdPaymentInput,
): Promise<VerifyPusdPaymentResult> {
  const connection = new Connection(
    input.rpcUrl ?? readSolanaRpcUrlFromEnv(),
    input.commitment ?? 'confirmed',
  )
  const transaction = await connection.getParsedTransaction(input.signature, {
    commitment: input.commitment ?? 'confirmed',
    maxSupportedTransactionVersion: 0,
  })

  if (!transaction) {
    return {
      valid: false,
      signature: input.signature,
      reason: 'transaction_not_found',
    }
  }

  if (transaction.meta?.err) {
    return {
      valid: false,
      signature: input.signature,
      reason: 'transaction_failed',
    }
  }

  const mint = new PublicKey(input.request.mint).toBase58()
  const recipient = new PublicKey(input.request.recipient).toBase58()
  const expectedAmount = parsePusdAmountToBaseUnits(input.request.amount)
  const preBalances = transaction.meta?.preTokenBalances ?? []
  const postBalances = transaction.meta?.postTokenBalances ?? []
  const preByAccount = new Map(
    preBalances.map((balance) => [
      `${balance.accountIndex}:${balance.mint}:${balance.owner ?? ''}`,
      BigInt(balance.uiTokenAmount.amount),
    ]),
  )
  let received = 0n

  for (const post of postBalances) {
    if (post.mint !== mint || post.owner !== recipient) {
      continue
    }
    const key = `${post.accountIndex}:${post.mint}:${post.owner ?? ''}`
    const before = preByAccount.get(key) ?? 0n
    const after = BigInt(post.uiTokenAmount.amount)
    if (after > before) {
      received += after - before
    }
  }

  if (received < expectedAmount) {
    return {
      valid: false,
      signature: input.signature,
      reason: 'insufficient_recipient_delta',
    }
  }

  const instructions = transaction.transaction.message.instructions
  if (!hasReferenceMemo(instructions, input.request.reference)) {
    return {
      valid: false,
      signature: input.signature,
      reason: 'reference_memo_missing',
    }
  }

  return {
    valid: true,
    signature: input.signature,
    amountBaseUnits: expectedAmount.toString(),
  }
}
