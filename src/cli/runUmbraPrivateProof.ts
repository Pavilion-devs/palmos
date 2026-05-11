import {
  type UmbraAssetSymbol,
  executeUmbraPrivateSettlement,
  readUmbraKeypair,
  readUmbraRuntimeConfig,
} from '../integrations/umbra/index.js'
import { loadProcessEnv } from '../env/loadProcessEnv.js'

function readFlag(args: string[], name: string): string | undefined {
  const exact = `--${name}`
  const prefix = `--${name}=`
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === exact) {
      return args[index + 1]
    }
    if (value?.startsWith(prefix)) {
      return value.slice(prefix.length)
    }
  }
  return undefined
}

function asUmbraAssetSymbol(value: string): UmbraAssetSymbol {
  if (value === 'wSOL' || value === 'dUSDC' || value === 'dUSDT') {
    return value
  }
  throw new Error(`Unsupported Umbra token: ${value}`)
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`)
}

async function writeJsonAndExit(payload: unknown, status: number): Promise<never> {
  await new Promise<void>((resolve) => {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`, () => {
      resolve()
    })
  })
  process.exit(status)
}

async function main(): Promise<void> {
  const env = loadProcessEnv()
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] == null && value != null) {
      process.env[key] = value
    }
  }

  const args = process.argv.slice(2)
  const config = readUmbraRuntimeConfig(env)
  const signerAddress = readUmbraKeypair(config.secretKeyBase64).publicKey.toBase58()
  const baseDir =
    readFlag(args, 'base-dir') ??
    env.AGENT_SPEND_OS_BASE_DIR?.trim() ??
    '/tmp/palmos-umbra-private'
  const agentId =
    readFlag(args, 'agent') ??
    env.PALMOS_UMBRA_AGENT_ID?.trim() ??
    'umbra_private_settlement_agent'
  const destinationAddress =
    readFlag(args, 'recipient') ??
    env.UMBRA_RECIPIENT_ADDRESS?.trim() ??
    signerAddress
  const amount =
    readFlag(args, 'amount') ??
    env.UMBRA_PRIVATE_AMOUNT?.trim() ??
    env.UMBRA_MIXER_TEST_AMOUNT?.trim() ??
    '0.001'
  const assetSymbol = asUmbraAssetSymbol(
    readFlag(args, 'token') ?? env.UMBRA_TOKEN?.trim() ?? 'wSOL',
  )

  const result = await executeUmbraPrivateSettlement({
    baseDir,
    agentId,
    destinationAddress,
    amount,
    assetSymbol,
    config,
    note: 'PalmOS governed Umbra private settlement proof',
    prefundWrappedSol: env.UMBRA_PREFUND_WSOL !== 'false',
    requireExistingAgent: hasFlag(args, 'require-existing-agent'),
  })

  await writeJsonAndExit(
    {
      ok: result.ok,
      baseDir,
      agent: {
        agentId: result.agent.agentId,
        status: result.agent.status,
        walletId: result.agent.walletId,
        proofSource: result.proofAgent.source,
        syntheticProofAgent: result.proofAgent.synthetic,
      },
      execution: {
        executionId: result.execution.executionId,
        status: result.execution.status,
        paymentRail: result.execution.paymentRail,
        runId: result.execution.runId,
        reportId: result.execution.umbraSettlement?.reportId,
        privacyPath: result.execution.umbraSettlement?.privacyPath,
        network: result.execution.umbraSettlement?.network,
        token: result.execution.umbraSettlement?.assetSymbol,
        amount: result.execution.umbraSettlement?.amount,
        finalTx: result.execution.umbraSettlement?.finalTransactionSignature,
        reconciliationStatus:
          result.execution.umbraSettlement?.reconciliationStatus,
        explorer: result.execution.transactionExplorerUrl,
      },
      turnOutput: result.turnOutput,
      error: result.error,
    },
    result.ok ? 0 : 1,
  )
}

main().catch((error) =>
  writeJsonAndExit(
    {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unable to complete Umbra private settlement proof.',
    },
    1,
  ),
)
