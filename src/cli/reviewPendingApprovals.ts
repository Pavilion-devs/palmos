import {
  createDefaultPalmosServiceCatalog,
  listPendingPaidApprovals,
  loadAgentSpendWorkspace,
  PalmosClient,
  readLocalPusdServerConfigFromEnv,
  resolvePendingPaidCallApproval,
  startLocalPusdDemoServer,
  OwsClient,
  XmtpNotifier,
} from '../index.js'
import { join } from 'path'

type Command =
  | { kind: 'list'; baseDir: string }
  | {
      kind: 'approve' | 'reject'
      baseDir: string
      executionId: string
      approverActorId: string
      approverRole: string
      comment?: string
    }

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

function parseCommand(args: string[], env: Record<string, string | undefined>): Command {
  const baseDir =
    readFlag(args, 'base-dir')?.trim() ||
    env.AGENT_SPEND_OS_BASE_DIR?.trim()

  if (!baseDir) {
    throw new Error(
      'A base directory is required. Set AGENT_SPEND_OS_BASE_DIR or pass --base-dir.',
    )
  }

  const [action, maybeExecutionId] = args.filter((value) => !value.startsWith('--'))
  if (!action || action === 'list') {
    return {
      kind: 'list',
      baseDir,
    }
  }

  if ((action === 'approve' || action === 'reject') && maybeExecutionId) {
    return {
      kind: action,
      baseDir,
      executionId: maybeExecutionId,
      approverActorId:
        readFlag(args, 'approver')?.trim() || 'manager_demo',
      approverRole: readFlag(args, 'role')?.trim() || 'manager',
      comment: readFlag(args, 'comment')?.trim(),
    }
  }

  throw new Error(
    'Usage: bun run approval:pending -- list [--base-dir <path>] or bun run approval:pending -- approve <executionId> [--base-dir <path>] [--approver <actorId>] [--role <role>] [--comment <text>]',
  )
}

const env = readProcessEnv()
const command = parseCommand(process.argv.slice(2), env)
const workspace = loadAgentSpendWorkspace({
  baseDir: command.baseDir,
})

if (command.kind === 'list') {
  const approvals = await listPendingPaidApprovals({
    paidCalls: workspace.paidCallRegistry,
    agentRegistry: workspace.agentRegistry,
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseDir: command.baseDir,
        pendingApprovals: approvals.map((approval) => ({
          executionId: approval.execution.executionId,
          agentId: approval.execution.agentId,
          serviceId: approval.execution.serviceId,
          amount: approval.execution.amount,
          assetSymbol: approval.execution.assetSymbol,
          runId: approval.execution.runId,
          createdAt: approval.execution.createdAt,
          requestSummary: approval.execution.requestSummary,
          agentStatus: approval.agent?.status,
        })),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const execution = await workspace.paidCallRegistry.get(command.executionId)
if (!execution) {
  throw new Error(`Unknown paid execution: ${command.executionId}`)
}

const agent = await workspace.agentRegistry.get(execution.agentId)
if (!agent) {
  throw new Error(`Unknown agent: ${execution.agentId}`)
}

let localServer:
  | Awaited<ReturnType<typeof startLocalPusdDemoServer>>
  | undefined
if (
  env.START_LOCAL_PUSD_SERVER === '1' &&
  execution.serviceId.startsWith('local.pusd.')
) {
  const vendor = agent.policyConfig.allowedVendors.find(
    (candidate) => candidate.vendorId === execution.vendorId,
  )
  if (vendor?.destinationAddress.trim()) {
    process.env.PUSD_MERCHANT_WALLET = vendor.destinationAddress
  }
  const serverConfig = readLocalPusdServerConfigFromEnv(process.env)
  localServer = await startLocalPusdDemoServer(serverConfig)
}

const localDemoBaseUrl =
  env.START_LOCAL_PUSD_SERVER === '1'
    ? `http://127.0.0.1:${localServer?.port ?? 4021}`
    : env.PUSD_DEMO_SERVER_BASE_URL?.trim() || 'http://127.0.0.1:4021'
const xmtpNotifier = XmtpNotifier.fromEnv(
  {
    ...env,
    XMTP_DB_PATH:
      env.XMTP_DB_PATH?.trim() || join(command.baseDir, 'xmtp-local.db3'),
  },
  workspace.xmtpAlertRegistry,
)

const result = await resolvePendingPaidCallApproval(
  {
    kernel: workspace.kernel,
    agentRegistry: workspace.agentRegistry,
    paidCalls: workspace.paidCallRegistry,
    palmosClient: PalmosClient.fromEnv(env),
    owsClient: workspace.owsClient ?? OwsClient.fromEnv(command.baseDir, env),
    serviceCatalog: createDefaultPalmosServiceCatalog({
      localDemoBaseUrl,
      localDemoSpotPriceAmount: env.PUSD_DEMO_SPOT_PRICE,
      localDemoOpsBriefAmount: env.PUSD_DEMO_OPS_BRIEF_PRICE,
    }),
    xmtpNotifier,
  },
  {
    executionId: command.executionId,
    decision: command.kind === 'approve' ? 'approved' : 'rejected',
    approverActorId: command.approverActorId,
    approverRole: command.approverRole,
    comment: command.comment,
  },
)

console.log(
  JSON.stringify(
    {
      ok: true,
      baseDir: command.baseDir,
      result,
    },
    null,
    2,
  ),
)

if (localServer) {
  await localServer.close()
}
