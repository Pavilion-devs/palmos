import {
  checkPusdPaymentReadiness,
  loadAgentSpendWorkspace,
  OwsClient,
  readPusdMintFromEnv,
  readSolanaRpcUrlFromEnv,
} from '../index.js'

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

function readFlag(args: string[], name: string): string | undefined {
  const exact = `--${name}`
  const prefixed = `--${name}=`
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (!value) {
      continue
    }
    if (value === exact) {
      return args[index + 1]
    }

    if (value.startsWith(prefixed)) {
      return value.slice(prefixed.length)
    }
  }

  return undefined
}

const env = readProcessEnv()
const args = process.argv.slice(2)
const baseDir = readFlag(args, 'base-dir') ?? env.AGENT_SPEND_OS_BASE_DIR
const walletName =
  readFlag(args, 'wallet') ?? env.PALMOS_READINESS_OWS_WALLET ?? 'research_agent'
const payer =
  readFlag(args, 'payer') ?? env.PUSD_AGENT_WALLET ?? undefined
const recipient =
  readFlag(args, 'recipient') ?? env.PUSD_MERCHANT_WALLET ?? undefined
const amount = readFlag(args, 'amount') ?? env.PUSD_READINESS_AMOUNT ?? '0.01'
const mint = readFlag(args, 'mint') ?? readPusdMintFromEnv(env)
const rpcUrl = readFlag(args, 'rpc-url') ?? readSolanaRpcUrlFromEnv(env)

async function main(): Promise<void> {
  let payerAddress = payer?.trim()
  if (!payerAddress && baseDir) {
    const workspace = loadAgentSpendWorkspace({ baseDir })
    const owsClient = workspace.owsClient ?? OwsClient.fromEnv(baseDir, env)
    payerAddress = owsClient?.getSolanaAddress(walletName)?.trim()
  }

  if (!payerAddress) {
    throw new Error(
      'Missing payer. Pass --payer, set PUSD_AGENT_WALLET, or provide --base-dir with an OWS wallet.',
    )
  }

  if (!recipient?.trim()) {
    throw new Error('Missing recipient. Pass --recipient or set PUSD_MERCHANT_WALLET.')
  }

  const report = await checkPusdPaymentReadiness({
    payer: payerAddress,
    recipient,
    amount,
    mint,
    rpcUrl,
    env,
  })

  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        baseDir,
        walletName: payer ? undefined : walletName,
        report,
      },
      null,
      2,
    ),
  )

  if (!report.ok) {
    process.exitCode = 1
  }
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to complete PUSD readiness check.',
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
