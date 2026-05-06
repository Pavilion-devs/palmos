import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { formatPusdBaseUnits, parsePusdAmountToBaseUnits } from './amount.js'
import { PUSD_DECIMALS, readPusdMintFromEnv, readSolanaRpcUrlFromEnv } from './constants.js'

export type PusdReadinessCheckStatus = 'passed' | 'failed' | 'warning'

export type PusdReadinessCheck = {
  checkId: string
  status: PusdReadinessCheckStatus
  summary: string
  details?: Record<string, unknown>
}

export type CheckPusdPaymentReadinessInput = {
  payer: PublicKey | string
  recipient: PublicKey | string
  amount: string
  mint?: PublicKey | string
  rpcUrl?: string
  minSolLamports?: number
  env?: Record<string, string | undefined>
}

export type PusdPaymentReadinessReport = {
  ok: boolean
  rpcUrl: string
  payer: string
  recipient: string
  mint: string
  amount: string
  amountBaseUnits: string
  payerTokenAccount: string
  recipientTokenAccount: string
  solBalanceLamports?: number
  pusdBalanceBaseUnits?: string
  checks: PusdReadinessCheck[]
}

function toPublicKey(value: PublicKey | string, label: string): PublicKey {
  try {
    return value instanceof PublicKey ? value : new PublicKey(value)
  } catch {
    throw new Error(`Invalid ${label} Solana address: ${String(value)}`)
  }
}

function addCheck(
  checks: PusdReadinessCheck[],
  check: PusdReadinessCheck,
): void {
  checks.push(check)
}

export async function checkPusdPaymentReadiness(
  input: CheckPusdPaymentReadinessInput,
): Promise<PusdPaymentReadinessReport> {
  const env = input.env ?? process.env
  const rpcUrl = input.rpcUrl ?? readSolanaRpcUrlFromEnv(env)
  const connection = new Connection(rpcUrl, 'confirmed')
  const payer = toPublicKey(input.payer, 'payer')
  const recipient = toPublicKey(input.recipient, 'recipient')
  const mint = toPublicKey(input.mint ?? readPusdMintFromEnv(env), 'PUSD mint')
  const amountBaseUnits = parsePusdAmountToBaseUnits(input.amount)
  const payerTokenAccount = await getAssociatedTokenAddress(mint, payer)
  const recipientTokenAccount = await getAssociatedTokenAddress(mint, recipient)
  const checks: PusdReadinessCheck[] = []
  const minSolLamports = input.minSolLamports ?? 10_000

  addCheck(checks, {
    checkId: 'pusd.addresses.valid',
    status: 'passed',
    summary: 'Payer, recipient, and mint are valid Solana public keys.',
  })

  const payerAccount = await connection.getAccountInfo(payer)
  if (!payerAccount) {
    addCheck(checks, {
      checkId: 'pusd.payer.exists',
      status: 'failed',
      summary: 'Payer account does not exist on the configured Solana RPC.',
      details: {
        payer: payer.toBase58(),
      },
    })
  } else {
    addCheck(checks, {
      checkId: 'pusd.payer.exists',
      status: 'passed',
      summary: 'Payer account exists on Solana.',
    })
  }

  const solBalanceLamports = await connection.getBalance(payer, 'confirmed')
  if (solBalanceLamports < minSolLamports) {
    addCheck(checks, {
      checkId: 'pusd.payer.sol_balance',
      status: 'failed',
      summary: 'Payer does not have enough SOL for transaction fees.',
      details: {
        balanceSol: solBalanceLamports / LAMPORTS_PER_SOL,
        balanceLamports: solBalanceLamports,
        minimumLamports: minSolLamports,
      },
    })
  } else {
    addCheck(checks, {
      checkId: 'pusd.payer.sol_balance',
      status: 'passed',
      summary: 'Payer has enough SOL for transaction fees.',
      details: {
        balanceSol: solBalanceLamports / LAMPORTS_PER_SOL,
        balanceLamports: solBalanceLamports,
      },
    })
  }

  const payerTokenAccountInfo = await connection.getAccountInfo(payerTokenAccount)
  if (!payerTokenAccountInfo) {
    addCheck(checks, {
      checkId: 'pusd.payer.ata_exists',
      status: 'failed',
      summary: 'Payer has no associated PUSD token account.',
      details: {
        payerTokenAccount: payerTokenAccount.toBase58(),
      },
    })
  } else {
    addCheck(checks, {
      checkId: 'pusd.payer.ata_exists',
      status: 'passed',
      summary: 'Payer associated PUSD token account exists.',
      details: {
        payerTokenAccount: payerTokenAccount.toBase58(),
      },
    })
  }

  let pusdBalanceBaseUnits: bigint | undefined
  if (payerTokenAccountInfo) {
    const balance = await connection.getTokenAccountBalance(
      payerTokenAccount,
      'confirmed',
    )
    if (balance.value.decimals !== PUSD_DECIMALS) {
      addCheck(checks, {
        checkId: 'pusd.payer.token_decimals',
        status: 'failed',
        summary: 'Payer token account decimals do not match PUSD decimals.',
        details: {
          expectedDecimals: PUSD_DECIMALS,
          actualDecimals: balance.value.decimals,
        },
      })
    }

    pusdBalanceBaseUnits = BigInt(balance.value.amount)
    if (pusdBalanceBaseUnits < amountBaseUnits) {
      addCheck(checks, {
        checkId: 'pusd.payer.balance',
        status: 'failed',
        summary: 'Payer PUSD balance is below the requested payment amount.',
        details: {
          balance: formatPusdBaseUnits(pusdBalanceBaseUnits),
          required: input.amount,
        },
      })
    } else {
      addCheck(checks, {
        checkId: 'pusd.payer.balance',
        status: 'passed',
        summary: 'Payer has enough PUSD for the requested payment.',
        details: {
          balance: formatPusdBaseUnits(pusdBalanceBaseUnits),
          required: input.amount,
        },
      })
    }
  }

  const recipientTokenAccountInfo = await connection.getAccountInfo(
    recipientTokenAccount,
  )
  if (!recipientTokenAccountInfo) {
    addCheck(checks, {
      checkId: 'pusd.recipient.ata_exists',
      status: 'warning',
      summary:
        'Recipient has no associated PUSD token account; the payment transaction will try to create it.',
      details: {
        recipientTokenAccount: recipientTokenAccount.toBase58(),
      },
    })
  } else {
    addCheck(checks, {
      checkId: 'pusd.recipient.ata_exists',
      status: 'passed',
      summary: 'Recipient associated PUSD token account exists.',
      details: {
        recipientTokenAccount: recipientTokenAccount.toBase58(),
      },
    })
  }

  return {
    ok: checks.every((check) => check.status !== 'failed'),
    rpcUrl,
    payer: payer.toBase58(),
    recipient: recipient.toBase58(),
    mint: mint.toBase58(),
    amount: input.amount,
    amountBaseUnits: amountBaseUnits.toString(),
    payerTokenAccount: payerTokenAccount.toBase58(),
    recipientTokenAccount: recipientTokenAccount.toBase58(),
    solBalanceLamports,
    pusdBalanceBaseUnits: pusdBalanceBaseUnits?.toString(),
    checks,
  }
}

export function formatPusdReadinessFailure(
  report: PusdPaymentReadinessReport,
): string {
  const failed = report.checks
    .filter((check) => check.status === 'failed')
    .map((check) => `${check.checkId}: ${check.summary}`)

  return failed.length > 0
    ? failed.join(' ')
    : 'PUSD readiness check failed for an unknown reason.'
}
