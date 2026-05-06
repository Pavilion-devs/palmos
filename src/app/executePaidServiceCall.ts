import { requestPaidAction, type RequestPaidActionDependencies } from './requestPaidAction.js'
import {
  createDefaultPalmosServiceCatalog,
  type PalmosServiceCatalog,
} from '../integrations/pusd/serviceCatalog.js'
import { type PalmosClient } from '../integrations/pusd/client.js'
import { PALMOS_PAYMENT_RAIL } from '../integrations/pusd/constants.js'
import {
  type X402ServiceCatalog,
} from '../integrations/x402/serviceCatalog.js'
import { type X402Client } from '../integrations/x402/client.js'
import type { OwsClient } from '../integrations/ows/client.js'
import type { XmtpNotifier } from '../integrations/xmtp/client.js'
import type { AgentRecord } from '../store/AgentRegistry.js'
import type {
  PaidCallPaymentRail,
  PaidCallRecord,
  PaidCallRegistry,
} from '../store/PaidCallRegistry.js'

export type ExecutePaidServiceCallInput = {
  agentId: string
  serviceId: string
  request: Record<string, unknown>
  amount?: string
  note?: string
}

export type ExecutePaidServiceCallDependencies = RequestPaidActionDependencies & {
  paidCalls?: PaidCallRegistry
  palmosClient?: PalmosClient
  x402Client?: X402Client
  owsClient?: OwsClient
  serviceCatalog?: PalmosServiceCatalog | X402ServiceCatalog
  xmtpNotifier?: XmtpNotifier
  createId?: (prefix: string) => string
}

export type ExecutePaidServiceCallResult =
  | {
      kind: 'blocked'
      agent: AgentRecord
      execution: PaidCallRecord
      reason: string
    }
  | {
      kind: 'approval_pending'
      agent: AgentRecord
      execution: PaidCallRecord
      turnOutput: string[]
    }
  | {
      kind: 'waiting_for_execution'
      agent: AgentRecord
      execution: PaidCallRecord
      turnOutput: string[]
    }
  | {
      kind: 'executed'
      agent: AgentRecord
      execution: PaidCallRecord
      turnOutput: string[]
    }
  | {
      kind: 'execution_failed'
      agent: AgentRecord
      execution: PaidCallRecord
      turnOutput: string[]
      error: string
    }

function createExecutionId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

type ParsedXPaymentResponse = {
  success?: boolean
  transaction?: string
  network?: string
  payer?: string
}

type ParsedPusdPaymentResponse = {
  success?: boolean
  transaction?: string
  reference?: string
  network?: string
  demo?: boolean
}

type SessionBudgetDecision =
  | {
      status: 'allowed'
      sessionBudget?: string
      spent: string
      remaining?: string
    }
  | {
      status: 'blocked'
      sessionBudget: string
      spent: string
      remaining: string
      projectedSpend: string
      reason: string
    }

function isPusdPaymentRequiredBody(body: unknown): body is import('../integrations/pusd/paymentInstructions.js').PusdPaymentRequiredResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    body.error === 'payment_required' &&
    'reference' in body &&
    typeof body.reference === 'string'
  )
}

function readHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const target = name.toLowerCase()
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === target,
  )
  return match?.[1]
}

function parseXPaymentResponseHeader(
  headers: Record<string, string>,
): ParsedXPaymentResponse | undefined {
  const encoded = readHeader(headers, 'x-payment-response')
  if (!encoded) {
    return undefined
  }

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    return JSON.parse(decoded) as ParsedXPaymentResponse
  } catch {
    return undefined
  }
}

function parsePusdPaymentResponseHeader(
  headers: Record<string, string>,
): ParsedPusdPaymentResponse | undefined {
  const encoded = readHeader(headers, 'x-pusd-payment-response')
  if (!encoded) {
    return undefined
  }

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    return JSON.parse(decoded) as ParsedPusdPaymentResponse
  } catch {
    return undefined
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }

  return response.text()
}

function collectHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries())
}

function mergeHeaders(
  initHeaders: HeadersInit | undefined,
  extra: Record<string, string>,
): Headers {
  const headers = new Headers(initHeaders)
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value)
  }
  return headers
}

function shouldUseOwsSolanaPayments(): boolean {
  return process.env.PALMOS_USE_OWS_SOLANA_PAYMENTS === '1'
}

function parseAmount(value: string | undefined): number {
  if (!value) {
    return 0
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatBudgetAmount(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, '')
}

function isBudgetCommittedStatus(status: PaidCallRecord['status']): boolean {
  return (
    status === 'executed' ||
    status === 'approval_pending' ||
    status === 'waiting_for_execution'
  )
}

async function evaluateSessionBudget(input: {
  paidCalls?: PaidCallRegistry
  agent: AgentRecord
  amount: string
  assetSymbol: string
}): Promise<SessionBudgetDecision> {
  const budgetAmount = parseAmount(input.agent.policyConfig.sessionBudget)
  const callAmount = parseAmount(input.amount)

  if (!input.paidCalls || budgetAmount <= 0 || callAmount <= 0) {
    return {
      status: 'allowed',
      sessionBudget: input.agent.policyConfig.sessionBudget,
      spent: '0',
    }
  }

  const records = await input.paidCalls.list()
  const spentAmount = records
    .filter((record) => record.agentId === input.agent.agentId)
    .filter((record) => record.assetSymbol === input.assetSymbol)
    .filter((record) => isBudgetCommittedStatus(record.status))
    .filter(
      (record) =>
        record.sessionId == null || record.sessionId === input.agent.sessionId,
    )
    .reduce((total, record) => total + parseAmount(record.amount), 0)

  const projectedSpend = spentAmount + callAmount
  const remaining = Math.max(budgetAmount - spentAmount, 0)
  if (projectedSpend > budgetAmount) {
    const sessionBudget = formatBudgetAmount(budgetAmount)
    const spent = formatBudgetAmount(spentAmount)
    const remainingFormatted = formatBudgetAmount(remaining)
    const projectedSpendFormatted = formatBudgetAmount(projectedSpend)

    return {
      status: 'blocked',
      sessionBudget,
      spent,
      remaining: remainingFormatted,
      projectedSpend: projectedSpendFormatted,
      reason: `Session budget exceeded. Budget ${sessionBudget} ${input.assetSymbol}, spent ${spent} ${input.assetSymbol}, requested ${formatBudgetAmount(callAmount)} ${input.assetSymbol}, projected ${projectedSpendFormatted} ${input.assetSymbol}.`,
    }
  }

  return {
    status: 'allowed',
    sessionBudget: formatBudgetAmount(budgetAmount),
    spent: formatBudgetAmount(spentAmount),
    remaining: formatBudgetAmount(budgetAmount - projectedSpend),
  }
}

async function executePalmosWithOws(input: {
  deps: ExecutePaidServiceCallDependencies
  wallet: string
  url: string
  init?: RequestInit
}): Promise<{
  status: number
  headers: Record<string, string>
  body: unknown
}> {
  const initialResponse = await fetch(input.url, input.init)
  const initialBody = await parseResponseBody(initialResponse)

  if (initialResponse.status !== 402 || !isPusdPaymentRequiredBody(initialBody)) {
    return {
      status: initialResponse.status,
      headers: collectHeaders(initialResponse.headers),
      body: initialBody,
    }
  }

  const payment = await input.deps.owsClient!.payPusdRequest({
    wallet: input.wallet,
    payment: initialBody,
    rpcUrl: process.env.PUSD_SOLANA_RPC_URL,
  })
  if (!payment.signature) {
    throw new Error('OWS did not return a Solana transaction signature.')
  }

  const retryResponse = await fetch(input.url, {
    ...input.init,
    headers: mergeHeaders(input.init?.headers, {
      'x-pusd-payment': payment.signature,
      'x-pusd-reference': initialBody.reference,
      'x-palmos-demo-payment': '0',
    }),
  })
  const retryBody = await parseResponseBody(retryResponse)

  return {
    status: retryResponse.status,
    headers: collectHeaders(retryResponse.headers),
    body: retryBody,
  }
}

async function refreshRunState(
  deps: ExecutePaidServiceCallDependencies,
  sessionId: string,
  runId: string,
) {
  const statusTurn = await deps.kernel.handleInput({
    sessionId,
    source: 'system',
    kind: 'status_query',
    runId,
  })

  return statusTurn.run
}

export async function loadRuntimeRunState(input: {
  deps: ExecutePaidServiceCallDependencies
  sessionId?: string
  runId?: string
}) {
  if (!input.sessionId || !input.runId) {
    return undefined
  }

  return refreshRunState(input.deps, input.sessionId, input.runId)
}

async function finalizeRuntimeRunFromPaidExecution(input: {
  deps: ExecutePaidServiceCallDependencies
  sessionId: string
  runId?: string
  signatureRequestId?: string
  transactionHash?: string
  status: 'signed' | 'failed'
  summary: string
}) {
  if (!input.runId || !input.signatureRequestId) {
    return undefined
  }

  await input.deps.kernel.ingestCallback({
    type: 'signature_status',
    runId: input.runId,
    status: input.status,
    signatureRequestId: input.signatureRequestId,
    transactionHash: input.transactionHash,
    summary: input.summary,
  })

  return refreshRunState(input.deps, input.sessionId, input.runId)
}

function toRecordBase(input: {
  executionId: string
  at: string
  agent: AgentRecord
  serviceId: string
  vendorId: string
  paymentRail: PaidCallPaymentRail
  amount: string
  assetSymbol: string
  chainId: string
  requestSummary: Record<string, unknown>
  requestUrl?: string
  runId?: string
  sessionId?: string
  runtimeStatus?: string
  runtimePhase?: string
  requestPayload: Record<string, unknown>
}): PaidCallRecord {
  return {
    executionId: input.executionId,
    createdAt: input.at,
    updatedAt: input.at,
    agentId: input.agent.agentId,
    serviceId: input.serviceId,
    vendorId: input.vendorId,
    paymentRail: input.paymentRail,
    amount: input.amount,
    assetSymbol: input.assetSymbol,
    chainId: input.chainId,
    status: 'waiting_for_execution',
    runId: input.runId,
    sessionId: input.sessionId,
    walletId: input.agent.walletId,
    runtimeStatus: input.runtimeStatus,
    runtimePhase: input.runtimePhase,
    requestPayload: input.requestPayload,
    requestSummary: input.requestSummary,
    requestUrl: input.requestUrl,
  }
}

export async function continueRuntimeBoundPaidExecution(
  deps: ExecutePaidServiceCallDependencies,
  input: {
    agent: AgentRecord
    execution: PaidCallRecord
    requestPayload: Record<string, unknown>
    turnOutput?: string[]
  },
): Promise<
  | {
      kind: 'waiting_for_execution'
      agent: AgentRecord
      execution: PaidCallRecord
      turnOutput: string[]
    }
  | {
      kind: 'executed'
      agent: AgentRecord
      execution: PaidCallRecord
      turnOutput: string[]
    }
  | {
      kind: 'execution_failed'
      agent: AgentRecord
      execution: PaidCallRecord
      turnOutput: string[]
      error: string
    }
> {
  const serviceCatalog =
    deps.serviceCatalog ?? createDefaultPalmosServiceCatalog()
  const service = serviceCatalog[input.execution.serviceId]

  if (!service) {
    throw new Error(`Unknown paid service: ${input.execution.serviceId}`)
  }

  const currentRun = await loadRuntimeRunState({
    deps,
    sessionId: input.execution.sessionId,
    runId: input.execution.runId,
  })
  const signatureRequestId = currentRun?.signatureRequestRefs.at(-1)
  const preparedRequest = service.buildRequest(input.requestPayload as never)
  const isPalmosRail = service.paymentRail === PALMOS_PAYMENT_RAIL
  const owsPayEligible =
    deps.owsClient != null &&
    input.agent.owsWalletName != null &&
    deps.owsClient.supportsPaymentChain(service.chainId) &&
    (!isPalmosRail || shouldUseOwsSolanaPayments())

  if (isPalmosRail && !deps.palmosClient && !owsPayEligible) {
    const pendingRecord: PaidCallRecord = {
      ...input.execution,
      status: 'waiting_for_execution',
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      runtimeStatus: currentRun?.status ?? input.execution.runtimeStatus,
      runtimePhase: currentRun?.currentPhase ?? input.execution.runtimePhase,
      errorCode: 'palmos.client_not_configured',
      errorMessage:
        'No PalmOS PUSD client is configured yet. Set PUSD_* env vars or enable local demo payments.',
    }
    await deps.paidCalls?.put(pendingRecord)
    return {
      kind: 'waiting_for_execution',
      agent: input.agent,
      execution: pendingRecord,
      turnOutput: input.turnOutput ?? [],
    }
  }

  if (!isPalmosRail && !deps.x402Client && !owsPayEligible) {
    const pendingRecord: PaidCallRecord = {
      ...input.execution,
      status: 'waiting_for_execution',
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      runtimeStatus: currentRun?.status ?? input.execution.runtimeStatus,
      runtimePhase: currentRun?.currentPhase ?? input.execution.runtimePhase,
      errorCode: 'x402.client_not_configured',
      errorMessage:
        'No x402 buyer wallet is configured yet. Set X402_BUYER_* env vars to execute paid calls.',
    }
    await deps.paidCalls?.put(pendingRecord)
    return {
      kind: 'waiting_for_execution',
      agent: input.agent,
      execution: pendingRecord,
      turnOutput: input.turnOutput ?? [],
    }
  }

  try {
    const palmosClient = deps.palmosClient
    const x402Client = deps.x402Client
    const response = owsPayEligible
      ? await (async () => {
          if (isPalmosRail) {
            return executePalmosWithOws({
              deps,
              wallet: input.agent.owsWalletName!,
              url: preparedRequest.url,
              init: preparedRequest.init,
            })
          }

          const owsResult = await deps.owsClient!.payRequest({
            wallet: input.agent.owsWalletName!,
            url: preparedRequest.url,
            method: preparedRequest.init?.method,
            body:
              typeof preparedRequest.init?.body === 'string'
                ? preparedRequest.init.body
                : undefined,
          })

          return {
            status: 200,
            headers: {
              'x-ows-payment-backend': 'pay_request',
            },
            body: owsResult.parsedBody ?? owsResult.stdout,
          }
        })()
      : isPalmosRail
        ? await palmosClient!.execute(
            service,
            input.requestPayload as never,
          )
        : await x402Client!.execute(
            service,
            input.requestPayload as never,
          )
    if (response.status >= 400) {
      const refreshedRun = await finalizeRuntimeRunFromPaidExecution({
        deps,
        sessionId: input.execution.sessionId ?? input.agent.sessionId,
        runId: input.execution.runId,
        signatureRequestId,
        status: 'failed',
        summary:
          response.status === 402
            ? 'Paid service execution failed because payment settlement was not accepted.'
            : `Paid service execution failed with HTTP ${response.status}.`,
      })
      const failedRecord: PaidCallRecord = {
        ...input.execution,
        status: 'failed',
        updatedAt: deps.now?.() ?? new Date().toISOString(),
        runtimeStatus: refreshedRun?.status ?? currentRun?.status ?? input.execution.runtimeStatus,
        runtimePhase:
          refreshedRun?.currentPhase ??
          currentRun?.currentPhase ??
          input.execution.runtimePhase,
        responseStatus: response.status,
        responseHeaders: response.headers,
        responsePreview: response.body,
        errorCode:
          response.status === 402
            ? isPalmosRail
              ? 'palmos.payment_required'
              : 'x402.payment_required'
            : `http.${response.status}`,
        errorMessage:
          response.status === 402
            ? 'The paid service responded with Payment Required. The buyer wallet likely needs funds or the payment could not be settled.'
            : `The paid service responded with status ${response.status}.`,
      }
      await deps.paidCalls?.put(failedRecord)
      return {
        kind: 'execution_failed',
        agent: input.agent,
        execution: failedRecord,
        turnOutput: input.turnOutput ?? [],
        error: failedRecord.errorMessage ?? 'Paid execution failed.',
      }
    }

    const paymentResponse = isPalmosRail
      ? parsePusdPaymentResponseHeader(response.headers)
      : parseXPaymentResponseHeader(response.headers)
    const refreshedRun = await finalizeRuntimeRunFromPaidExecution({
      deps,
      sessionId: input.execution.sessionId ?? input.agent.sessionId,
      runId: input.execution.runId,
      signatureRequestId,
      transactionHash: paymentResponse?.transaction,
      status: 'signed',
      summary: isPalmosRail
        ? 'Paid PalmOS PUSD execution succeeded and settlement was observed.'
        : 'Paid x402 execution succeeded and settlement was observed.',
    })

    const executedRecord: PaidCallRecord = {
      ...input.execution,
      status: 'executed',
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      runtimeStatus: refreshedRun?.status ?? currentRun?.status ?? input.execution.runtimeStatus,
      runtimePhase:
        refreshedRun?.currentPhase ??
        currentRun?.currentPhase ??
        input.execution.runtimePhase,
      responseStatus: response.status,
      responseHeaders: response.headers,
      responsePreview: response.body,
      errorCode: undefined,
      errorMessage: undefined,
      transactionSignature: paymentResponse?.transaction,
    }
    await deps.paidCalls?.put(executedRecord)
    return {
      kind: 'executed',
      agent: input.agent,
      execution: executedRecord,
      turnOutput: input.turnOutput ?? [],
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown paid execution error.'
    const refreshedRun = await finalizeRuntimeRunFromPaidExecution({
      deps,
      sessionId: input.execution.sessionId ?? input.agent.sessionId,
      runId: input.execution.runId,
      signatureRequestId,
      status: 'failed',
      summary: 'Paid service execution raised an exception before settlement completed.',
    })
    const failedRecord: PaidCallRecord = {
      ...input.execution,
      status: 'failed',
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      runtimeStatus: refreshedRun?.status ?? currentRun?.status ?? input.execution.runtimeStatus,
      runtimePhase:
        refreshedRun?.currentPhase ??
        currentRun?.currentPhase ??
        input.execution.runtimePhase,
      errorCode: isPalmosRail
        ? 'palmos.execution_failed'
        : 'x402.execution_failed',
      errorMessage: message,
    }
    await deps.paidCalls?.put(failedRecord)
    return {
      kind: 'execution_failed',
      agent: input.agent,
      execution: failedRecord,
      turnOutput: input.turnOutput ?? [],
      error: message,
    }
  }
}

export async function executePaidServiceCall(
  deps: ExecutePaidServiceCallDependencies,
  input: ExecutePaidServiceCallInput,
): Promise<ExecutePaidServiceCallResult> {
  const serviceCatalog =
    deps.serviceCatalog ?? createDefaultPalmosServiceCatalog()
  const service = serviceCatalog[input.serviceId]

  if (!service) {
    throw new Error(`Unknown paid service: ${input.serviceId}`)
  }

  const executionId = deps.createId?.('paid_call') ?? createExecutionId('paid_call')
  const at = deps.now?.() ?? new Date().toISOString()
  const preparedRequest = service.buildRequest(input.request)
  const amount = input.amount ?? service.expectedAmount
  const agent = await deps.agentRegistry.get(input.agentId)

  if (!agent) {
    throw new Error(`Unknown agent: ${input.agentId}`)
  }

  const budgetDecision = await evaluateSessionBudget({
    paidCalls: deps.paidCalls,
    agent,
    amount,
    assetSymbol: service.assetSymbol,
  })

  if (budgetDecision.status === 'blocked') {
    const blockedRecord: PaidCallRecord = {
      ...toRecordBase({
        executionId,
        at,
        agent,
        serviceId: input.serviceId,
        vendorId: service.vendorId,
        paymentRail: service.paymentRail,
        amount,
        assetSymbol: service.assetSymbol,
        chainId: service.chainId,
        requestPayload: input.request,
        requestSummary: preparedRequest.requestSummary,
        requestUrl: preparedRequest.url,
        sessionId: agent.sessionId,
      }),
      status: 'blocked',
      errorCode: 'policy.session_budget_exceeded',
      errorMessage: budgetDecision.reason,
      responsePreview: {
        sessionBudget: budgetDecision.sessionBudget,
        sessionSpent: budgetDecision.spent,
        sessionRemaining: budgetDecision.remaining,
        projectedSpend: budgetDecision.projectedSpend,
      },
    }
    await deps.paidCalls?.put(blockedRecord)
    return {
      kind: 'blocked',
      agent,
      execution: blockedRecord,
      reason: budgetDecision.reason,
    }
  }

  const submitted = await requestPaidAction(deps, {
    agentId: input.agentId,
    serviceId: input.serviceId,
    amount,
    assetSymbol: service.assetSymbol,
    vendorId: service.vendorId,
    chainId: service.chainId,
    note: input.note ?? `paid:${input.serviceId}`,
  })

  if (submitted.kind === 'blocked') {
    const blockedRecord: PaidCallRecord = {
      ...toRecordBase({
        executionId,
        at,
        agent: submitted.agent,
        serviceId: input.serviceId,
        vendorId: service.vendorId,
        paymentRail: service.paymentRail,
        amount,
        assetSymbol: service.assetSymbol,
        chainId: service.chainId,
        requestPayload: input.request,
        requestSummary: preparedRequest.requestSummary,
        requestUrl: preparedRequest.url,
      }),
      status: 'blocked',
      errorCode: 'policy.blocked',
      errorMessage: submitted.reason,
    }
    await deps.paidCalls?.put(blockedRecord)
    return {
      kind: 'blocked',
      agent: submitted.agent,
      execution: blockedRecord,
      reason: submitted.reason,
    }
  }

  const submittedRun = submitted.turn.run
  const submittedRecordBase = toRecordBase({
    executionId,
    at,
    agent: submitted.agent,
    serviceId: input.serviceId,
    vendorId: service.vendorId,
    paymentRail: service.paymentRail,
    amount,
    assetSymbol: service.assetSymbol,
    chainId: service.chainId,
    requestPayload: input.request,
    requestSummary: preparedRequest.requestSummary,
    requestUrl: preparedRequest.url,
    runId: submittedRun?.runId,
    sessionId: submitted.turn.session.sessionId,
    runtimeStatus: submittedRun?.status,
    runtimePhase: submittedRun?.currentPhase,
  })

  if (submittedRun?.status === 'failed') {
    const blockedRecord: PaidCallRecord = {
      ...submittedRecordBase,
      status: 'blocked',
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      errorCode: 'policy.runtime_denied',
      errorMessage:
        submitted.turn.output.at(-1) ??
        'Runtime policy denied the paid action before execution.',
    }
    await deps.paidCalls?.put(blockedRecord)
    return {
      kind: 'blocked',
      agent: submitted.agent,
      execution: blockedRecord,
      reason:
        blockedRecord.errorMessage ??
        'Runtime policy denied the paid action before execution.',
    }
  }

  if (submittedRun?.status === 'waiting_for_approval') {
    const approvalRecord: PaidCallRecord = {
      ...submittedRecordBase,
      status: 'approval_pending',
      updatedAt: deps.now?.() ?? new Date().toISOString(),
    }
    await deps.paidCalls?.put(approvalRecord)
    await deps.xmtpNotifier?.sendApprovalRequested({
      agent: submitted.agent,
      execution: approvalRecord,
    })
    return {
      kind: 'approval_pending',
      agent: submitted.agent,
      execution: approvalRecord,
      turnOutput: submitted.turn.output,
    }
  }

  return continueRuntimeBoundPaidExecution(deps, {
    agent: submitted.agent,
    execution: {
      ...submittedRecordBase,
      status: 'waiting_for_execution',
    },
    requestPayload: input.request,
    turnOutput: submitted.turn.output,
  })
}
