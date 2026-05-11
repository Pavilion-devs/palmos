import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  NATIVE_MINT,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'

export type EnsureWrappedSolResult = {
  ataAddress: string
  ataExisted: boolean
  amountWrapped: bigint
  previousBalance: bigint
  newBalance: bigint
  signature?: string
}

export async function ensureWrappedSol(input: {
  connection: Connection
  keypair: Keypair
  targetLamports: bigint
}): Promise<EnsureWrappedSolResult> {
  const owner = input.keypair.publicKey
  const ataAddress = await getAssociatedTokenAddress(NATIVE_MINT, owner)
  let ataExisted = false
  let previousBalance = 0n

  try {
    const account = await getAccount(input.connection, ataAddress)
    ataExisted = true
    previousBalance = account.amount
  } catch {
    ataExisted = false
  }

  if (previousBalance >= input.targetLamports) {
    return {
      ataAddress: ataAddress.toBase58(),
      ataExisted,
      amountWrapped: 0n,
      previousBalance,
      newBalance: previousBalance,
    }
  }

  const amountWrapped = input.targetLamports - previousBalance
  const transaction = new Transaction()

  if (!ataExisted) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        owner,
        ataAddress,
        owner,
        NATIVE_MINT,
      ),
    )
  }

  transaction.add(
    SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: ataAddress,
      lamports: Number(amountWrapped),
    }),
  )
  transaction.add(createSyncNativeInstruction(ataAddress))

  const signature = await sendAndConfirmTransaction(
    input.connection,
    transaction,
    [input.keypair],
    { commitment: 'confirmed' },
  )
  const updatedAccount = await getAccount(input.connection, ataAddress)

  return {
    ataAddress: ataAddress.toBase58(),
    ataExisted,
    amountWrapped,
    previousBalance,
    newBalance: updatedAccount.amount,
    signature,
  }
}
