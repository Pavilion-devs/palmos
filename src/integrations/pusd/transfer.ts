import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type Keypair,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import type { PusdPaymentRequiredResponse } from './paymentInstructions.js'
import { parsePusdAmountToBaseUnits } from './amount.js'
import { PUSD_DECIMALS, readSolanaRpcUrlFromEnv } from './constants.js'

const MEMO_PROGRAM_ID = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
)

export type SendPusdPaymentInput = {
  payment: PusdPaymentRequiredResponse
  payer: Keypair
  rpcUrl?: string
  commitment?: 'confirmed' | 'finalized'
}

export type BuildUnsignedPusdPaymentTransactionInput = {
  payment: PusdPaymentRequiredResponse
  payer: PublicKey
  rpcUrl?: string
  commitment?: 'confirmed' | 'finalized'
}

async function accountExists(
  connection: Connection,
  address: PublicKey,
): Promise<boolean> {
  return (await connection.getAccountInfo(address)) != null
}

export async function buildUnsignedPusdPaymentTransaction(
  input: BuildUnsignedPusdPaymentTransactionInput,
): Promise<Transaction> {
  const connection = new Connection(
    input.rpcUrl ?? readSolanaRpcUrlFromEnv(),
    input.commitment ?? 'confirmed',
  )
  const mint = new PublicKey(input.payment.mint)
  const recipientOwner = new PublicKey(input.payment.recipient)
  const payerOwner = input.payer
  const payerTokenAccount = await getAssociatedTokenAddress(mint, payerOwner)
  const recipientTokenAccount = await getAssociatedTokenAddress(
    mint,
    recipientOwner,
  )
  const amount = parsePusdAmountToBaseUnits(input.payment.amount)
  const transaction = new Transaction()

  if (!(await accountExists(connection, payerTokenAccount))) {
    throw new Error(
      `Payer has no PUSD associated token account: ${payerTokenAccount.toBase58()}`,
    )
  }

  if (!(await accountExists(connection, recipientTokenAccount))) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        payerOwner,
        recipientTokenAccount,
        recipientOwner,
        mint,
      ),
    )
  }

  transaction.add(
    createTransferCheckedInstruction(
      payerTokenAccount,
      mint,
      recipientTokenAccount,
      payerOwner,
      amount,
      PUSD_DECIMALS,
    ),
  )
  transaction.add(
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(input.payment.reference, 'utf8'),
    }),
  )
  const latestBlockhash = await connection.getLatestBlockhash(
    input.commitment ?? 'confirmed',
  )
  transaction.feePayer = payerOwner
  transaction.recentBlockhash = latestBlockhash.blockhash

  return transaction
}

export async function sendPusdPayment(
  input: SendPusdPaymentInput,
): Promise<string> {
  const connection = new Connection(
    input.rpcUrl ?? readSolanaRpcUrlFromEnv(),
    input.commitment ?? 'confirmed',
  )
  const transaction = await buildUnsignedPusdPaymentTransaction({
    payment: input.payment,
    payer: input.payer.publicKey,
    rpcUrl: input.rpcUrl,
    commitment: input.commitment,
  })

  return sendAndConfirmTransaction(connection, transaction, [input.payer], {
    commitment: input.commitment ?? 'confirmed',
  })
}
