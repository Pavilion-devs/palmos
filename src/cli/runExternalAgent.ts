import {
  PalmosAgentClient,
  PalmosAgentClientError,
  type PalmosSdkService,
} from '../sdk/PalmosAgentClient.js'
import { loadProcessEnv } from '../env/loadProcessEnv.js'

type ExternalAgentRunSummary = {
  ok: boolean
  mode: 'external_agent_sdk'
  apiUrl: string
  agent?: {
    agentId: string
    displayName?: string
    status?: string
  }
  credential?: {
    credentialId?: string
    keyPrefix?: string
    status?: string
  }
  service?: {
    serviceId: string
    label?: string
    vendorId?: string
    allowed?: boolean
    expectedAmount?: string
  }
  request?: Record<string, unknown>
  outcome?: {
    kind?: string
    label: string
    executionId?: string
    status?: string
    amount?: string
    assetSymbol?: string
    reason?: string
    transactionSignature?: string
    transactionExplorerUrl?: string
    dashboardPath?: string
  }
  serviceData?: unknown
  error?: string
}

function readProcessEnv(): Record<string, string | undefined> {
  return loadProcessEnv()
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

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`)
}

function parseRequestJson(value: string | undefined): Record<string, unknown> {
  if (!value?.trim()) {
    return {
      base: 'BTC',
      quote: 'USD',
    }
  }

  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Agent request JSON must be an object.')
  }

  return parsed as Record<string, unknown>
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readExecution(result: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return readRecord(result?.execution)
}

function buildDashboardPath(kind: string | undefined, executionId: string | undefined): string | undefined {
  if (!executionId) {
    return undefined
  }

  if (kind === 'approval_pending') {
    return `#dashboard/approvals`
  }

  return `#dashboard/transactions/${executionId}`
}

function labelForKind(kind: string | undefined): string {
  if (kind === 'executed') {
    return 'AUTO-APPROVED / EXECUTED'
  }
  if (kind === 'approval_pending') {
    return 'PENDING OPERATOR APPROVAL'
  }
  if (kind === 'blocked') {
    return 'POLICY BLOCK'
  }
  if (kind === 'execution_failed') {
    return 'EXECUTION FAILED'
  }
  if (kind === 'waiting_for_execution') {
    return 'WAITING FOR EXECUTION'
  }
  return 'UNKNOWN'
}

function buildSummary(input: {
  apiUrl: string
  agent?: ExternalAgentRunSummary['agent']
  credential?: ExternalAgentRunSummary['credential']
  service?: PalmosSdkService
  request?: Record<string, unknown>
  sdkPayload?: unknown
  error?: string
}): ExternalAgentRunSummary {
  const sdkPayload = readRecord(input.sdkPayload)
  const result = readRecord(sdkPayload?.result) ?? readRecord(input.sdkPayload)
  const execution = readExecution(result)
  const kind = readString(result?.kind)
  const executionId = readString(execution?.executionId)
  const reason =
    readString(result?.reason) ??
    readString(result?.error) ??
    readString(execution?.errorMessage) ??
    input.error

  const rawPreview = execution?.responsePreview
  const serviceData =
    rawPreview && typeof rawPreview === 'object' && !Array.isArray(rawPreview)
      ? (rawPreview as Record<string, unknown>).data ?? rawPreview
      : undefined

  return {
    ok: !input.error,
    mode: 'external_agent_sdk',
    apiUrl: input.apiUrl,
    agent: input.agent,
    credential: input.credential,
    service: input.service
      ? {
          serviceId: input.service.serviceId,
          label: input.service.label,
          vendorId: input.service.vendorId,
          allowed: input.service.allowed,
          expectedAmount: input.service.expectedAmount,
        }
      : undefined,
    request: input.request,
    outcome: {
      kind,
      label: labelForKind(kind),
      executionId,
      status: readString(execution?.status),
      amount: readString(execution?.amount),
      assetSymbol: readString(execution?.assetSymbol),
      reason,
      transactionSignature: readString(execution?.transactionSignature),
      transactionExplorerUrl: readString(execution?.transactionExplorerUrl),
      dashboardPath: buildDashboardPath(kind, executionId),
    },
    serviceData: kind === 'executed' ? serviceData : undefined,
    error: input.error,
  }
}

function printHuman(summary: ExternalAgentRunSummary): void {
  const lines = [
    '',
    'PalmOS external agent run',
    '-------------------------',
    `API: ${summary.apiUrl}`,
    summary.agent
      ? `Agent: ${summary.agent.displayName ?? summary.agent.agentId} (${summary.agent.agentId})`
      : undefined,
    summary.credential?.keyPrefix
      ? `Credential: ${summary.credential.keyPrefix}... (${summary.credential.status ?? 'unknown'})`
      : undefined,
    summary.service
      ? `Service: ${summary.service.label ?? summary.service.serviceId} (${summary.service.serviceId})`
      : undefined,
    summary.service
      ? `Policy listed service as: ${summary.service.allowed ? 'allowed' : 'not allowed'}`
      : undefined,
    summary.request
      ? `Request: ${JSON.stringify(summary.request)}`
      : undefined,
    '',
    `Outcome: ${summary.outcome?.label ?? 'UNKNOWN'}`,
    summary.outcome?.amount
      ? `Amount: ${summary.outcome.amount} ${summary.outcome.assetSymbol ?? 'PUSD'}`
      : undefined,
    summary.outcome?.executionId
      ? `Execution: ${summary.outcome.executionId}`
      : undefined,
    summary.outcome?.reason
      ? `Reason: ${summary.outcome.reason}`
      : undefined,
    summary.outcome?.transactionExplorerUrl
      ? `Explorer: ${summary.outcome.transactionExplorerUrl}`
      : undefined,
    summary.outcome?.dashboardPath
      ? `Dashboard: ${summary.outcome.dashboardPath}`
      : undefined,
    summary.serviceData
      ? `\nService response:\n${JSON.stringify(summary.serviceData, null, 2)
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n')}`
      : undefined,
    '',
  ].filter((line): line is string => line !== undefined)

  console.log(lines.join('\n'))
}

function printUsage(): void {
  console.log(`PalmOS external agent demo

Usage:
  npm run palmos:external-agent -- [options]

Options:
  --api-url <url>          PalmOS backend URL. Defaults to PALMOS_API_URL or http://127.0.0.1:4030
  --token <palmos_...>     Agent SDK token. Defaults to PALMOS_AGENT_TOKEN
  --service <serviceId>    Service to request. Defaults to PALMOS_SERVICE_ID or local.pusd.spot_price
  --request-json <json>    JSON request payload. Defaults to PALMOS_AGENT_REQUEST_JSON or {"base":"BTC","quote":"USD"}
  --amount <amount>        Optional PUSD amount override
  --note <text>            Optional audit note
  --json                   Print machine-readable JSON
  --help                   Show this help
`)
}

const env = readProcessEnv()
const args = process.argv.slice(2)

if (hasFlag(args, 'help')) {
  printUsage()
  process.exit(0)
}

const jsonOutput = hasFlag(args, 'json')
const token = readFlag(args, 'token') ?? env.PALMOS_AGENT_TOKEN
const apiUrl =
  readFlag(args, 'api-url') ?? env.PALMOS_API_URL ?? 'http://127.0.0.1:4030'
const serviceId =
  readFlag(args, 'service') ??
  env.PALMOS_SERVICE_ID ??
  'local.pusd.spot_price'
const amount = readFlag(args, 'amount') ?? env.PALMOS_AGENT_AMOUNT
const note =
  readFlag(args, 'note') ??
  env.PALMOS_AGENT_NOTE ??
  'external-agent:paid-service-call'
const request = parseRequestJson(
  readFlag(args, 'request-json') ?? env.PALMOS_AGENT_REQUEST_JSON,
)

async function main(): Promise<void> {
  if (!token?.trim()) {
    throw new Error(
      'Missing PalmOS agent token. Set PALMOS_AGENT_TOKEN or pass --token palmos_...',
    )
  }

  const client = new PalmosAgentClient({
    baseUrl: apiUrl,
    token,
  })
  const me = await client.me()
  const services = await client.listServices()
  const targetService = services.services.find(
    (service) => service.serviceId === serviceId,
  )
  if (!targetService) {
    throw new Error(`Service ${serviceId} is not registered with PalmOS.`)
  }

  try {
    const payment = await client.pay({
      serviceId,
      request,
      amount,
      note,
    })
    const summary = buildSummary({
      apiUrl,
      agent: {
        agentId: me.agent.agentId,
        displayName: me.agent.displayName,
        status: me.agent.status,
      },
      credential: {
        credentialId: me.credential.credentialId,
        keyPrefix: me.credential.keyPrefix,
        status: me.credential.status,
      },
      service: targetService,
      request,
      sdkPayload: payment,
    })

    if (jsonOutput) {
      console.log(JSON.stringify(summary, null, 2))
    } else {
      printHuman(summary)
    }
  } catch (error) {
    if (error instanceof PalmosAgentClientError) {
      const summary = buildSummary({
        apiUrl,
        agent: {
          agentId: me.agent.agentId,
          displayName: me.agent.displayName,
          status: me.agent.status,
        },
        credential: {
          credentialId: me.credential.credentialId,
          keyPrefix: me.credential.keyPrefix,
          status: me.credential.status,
        },
        service: targetService,
        request,
        sdkPayload: error.payload,
        error: error.message,
      })

      if (jsonOutput) {
        console.log(JSON.stringify(summary, null, 2))
      } else {
        printHuman(summary)
      }

      if (summary.outcome?.kind !== 'blocked') {
        process.exitCode = 1
      }
      return
    }

    throw error
  }
}

void main().catch((error) => {
  const summary: ExternalAgentRunSummary = {
    ok: false,
    mode: 'external_agent_sdk',
    apiUrl,
    request,
    outcome: {
      label: 'FAILED BEFORE POLICY',
    },
    error:
      error instanceof Error
        ? error.message
        : 'External PalmOS agent run failed.',
  }

  if (jsonOutput) {
    console.error(JSON.stringify(summary, null, 2))
  } else {
    printHuman(summary)
  }
  process.exitCode = 1
})
