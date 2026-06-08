import { requestPaidAction, type RequestPaidActionDependencies } from './requestPaidAction.js'
import {
  createDefaultPalmosServiceCatalog,
  type PalmosServiceCatalog,
} from '../integrations/pusd/serviceCatalog.js'
import {
  type PalmosClient,
  type PalmosExecutionSettlement,
} from '../integrations/pusd/client.js'
import {
  formatPusdBaseUnits,
  parsePusdAmountToBaseUnits,
} from '../integrations/pusd/amount.js'
import {
  fetchWithTimeout,
  parseResponseBodyWithLimit,
} from '../integrations/pusd/httpSafety.js'
import {
  PALMOS_PAYMENT_RAIL,
  readPusdMintFromEnv,
} from '../integrations/pusd/constants.js'
import {
  assertPusdPaymentInstructionMatchesPolicy,
  type ExpectedPusdPaymentInstruction,
  type PusdPaymentRequiredResponse,
} from '../integrations/pusd/paymentInstructions.js'
import {
  type X402ServiceCatalog,
} from '../integrations/x402/serviceCatalog.js'
import { type X402Client } from '../integrations/x402/client.js'
import type { OwsClient } from '../integrations/ows/client.js'
import type { XmtpNotifier } from '../integrations/xmtp/client.js'
import {
  readServiceEndpointAllowlist,
  type EndpointLookup,
} from '../server/dashboard/serviceEndpointSafety.js'
import {
  evaluatePalmosServiceReadiness,
  formatServiceReadinessFailure,
} from '../server/dashboard/serviceReadiness.js'
import {
  normalizeAgentSettlementMode,
  type AgentRecord,
  type AgentSettlementMode,
} from '../store/AgentRegistry.js'
import type {
  ActionRequestRecord,
  ActionRequestRegistry,
  ActionRequestSource,
} from '../store/ActionRequestRegistry.js'
import type {
  PaidCallPaymentRail,
  PaidCallRecord,
  PaidCallRegistry,
} from '../store/PaidCallRegistry.js'
import {
  buildPaidCallSettlementRecord,
  buildSolscanTransactionUrl,
  toSolanaCluster,
} from './settlementRecords.js'
import { readLocalDemoSettlementPosture } from './localDemoSettlement.js'

export type ExecutePaidServiceCallInput = {
  agentId: string
  serviceId: string
  request: Record<string, unknown>
  amount?: string
  note?: string
  source?: ActionRequestSource
}

export type ExecutePaidServiceCallDependencies = RequestPaidActionDependencies & {
  actionRequests?: ActionRequestRegistry
  paidCalls?: PaidCallRegistry
  palmosClient?: PalmosClient
  x402Client?: X402Client
  owsClient?: OwsClient
  serviceCatalog?: PalmosServiceCatalog | X402ServiceCatalog
  xmtpNotifier?: XmtpNotifier
  createId?: (prefix: string) => string
  serviceEndpointLookup?: EndpointLookup
  serviceEndpointAllowlist?: string[]
  env?: Record<string, string | undefined>
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

function mapActionRequestConnectorKind(
  paymentRail: PaidCallPaymentRail,
): ActionRequestRecord['executionPlan'] extends infer Plan
  ? Plan extends { connectorKind?: infer Kind }
    ? Kind
    : string | undefined
  : string | undefined {
  switch (paymentRail) {
    case 'palmos-pusd':
      return 'pusd'
    case 'umbra':
      return 'umbra'
    default:
      return paymentRail
  }
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

type PalmosSettlementMetadata =
  | PalmosExecutionSettlement
  | (Omit<PalmosExecutionSettlement, 'mode'> & { mode: 'ows' })

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
      reasonCode?: 'policy.invalid_amount' | 'policy.session_budget_exceeded'
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
  return parseResponseBodyWithLimit(response)
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

function resolveAgentSettlementMode(agent: AgentRecord): AgentSettlementMode {
  if (agent.settlementMode) {
    return normalizeAgentSettlementMode(agent.settlementMode)
  }

  if (agent.walletBackend === 'ows' && shouldUseOwsSolanaPayments()) {
    return 'ows'
  }

  return 'local-demo'
}

function readRealPusdMaxAmount(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return (
    env.PALMOS_REAL_PUSD_MAX_PER_CALL?.trim() ||
    env.PUSD_MAX_PER_CALL?.trim() ||
    undefined
  )
}

function assertWithinRealPusdCap(amount: string, cap?: string): void {
  if (!cap) {
    return
  }

  const amountBaseUnits = parsePusdAmountToBaseUnits(amount)
  const capBaseUnits = parsePusdAmountToBaseUnits(cap)
  if (amountBaseUnits > capBaseUnits) {
    throw new Error(
      `PUSD payment amount ${amount} exceeds configured real-payment cap ${cap}.`,
    )
  }
}

function parseBudgetAmount(value: string | undefined): {
  amount?: bigint
  invalid: boolean
} {
  if (value == null || value.trim() === '') {
    return { invalid: false }
  }

  try {
    return {
      amount: parsePusdAmountToBaseUnits(value),
      invalid: false,
    }
  } catch {
    return { invalid: true }
  }
}

function formatBudgetAmount(value: bigint): string {
  return formatPusdBaseUnits(value)
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
  const budgetAmount = parseBudgetAmount(input.agent.policyConfig.sessionBudget)
  const callAmount = parseBudgetAmount(input.amount)

  if (budgetAmount.invalid) {
    return {
      status: 'blocked',
      sessionBudget: input.agent.policyConfig.sessionBudget ?? 'invalid',
      spent: '0',
      remaining: '0',
      projectedSpend: input.amount,
      reason: `Invalid session budget amount: ${input.agent.policyConfig.sessionBudget}.`,
      reasonCode: 'policy.invalid_amount',
    }
  }

  if (!input.paidCalls || budgetAmount.amount == null || budgetAmount.amount <= 0n) {
    return {
      status: 'allowed',
      sessionBudget: input.agent.policyConfig.sessionBudget,
      spent: '0',
    }
  }

  if (callAmount.invalid || callAmount.amount == null || callAmount.amount <= 0n) {
    return {
      status: 'blocked',
      sessionBudget: formatBudgetAmount(budgetAmount.amount),
      spent: '0',
      remaining: formatBudgetAmount(budgetAmount.amount),
      projectedSpend: '0',
      reason: `Invalid requested payment amount: ${input.amount}.`,
      reasonCode: 'policy.invalid_amount',
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
    .reduce((total, record) => {
      try {
        return total + parsePusdAmountToBaseUnits(record.amount)
      } catch {
        return total
      }
    }, 0n)

  const projectedSpend = spentAmount + callAmount.amount
  const remaining =
    budgetAmount.amount > spentAmount ? budgetAmount.amount - spentAmount : 0n
  if (projectedSpend > budgetAmount.amount) {
    const sessionBudget = formatBudgetAmount(budgetAmount.amount)
    const spent = formatBudgetAmount(spentAmount)
    const remainingFormatted = formatBudgetAmount(remaining)
    const projectedSpendFormatted = formatBudgetAmount(projectedSpend)

    return {
      status: 'blocked',
      sessionBudget,
      spent,
      remaining: remainingFormatted,
      projectedSpend: projectedSpendFormatted,
      reason: `Session budget exceeded. Budget ${sessionBudget} ${input.assetSymbol}, spent ${spent} ${input.assetSymbol}, requested ${formatBudgetAmount(callAmount.amount)} ${input.assetSymbol}, projected ${projectedSpendFormatted} ${input.assetSymbol}.`,
      reasonCode: 'policy.session_budget_exceeded',
    }
  }

  return {
    status: 'allowed',
    sessionBudget: formatBudgetAmount(budgetAmount.amount),
    spent: formatBudgetAmount(spentAmount),
    remaining: formatBudgetAmount(budgetAmount.amount - projectedSpend),
  }
}

async function executePalmosWithOws(input: {
  deps: ExecutePaidServiceCallDependencies
  wallet: string
  url: string
  init?: RequestInit
  expectedPayment?: ExpectedPusdPaymentInstruction
}): Promise<{
  status: number
  headers: Record<string, string>
  body: unknown
  settlement?: Omit<PalmosExecutionSettlement, 'mode'> & { mode: 'ows' }
}> {
  const initialResponse = await fetchWithTimeout(fetch, input.url, input.init)
  const initialBody = await parseResponseBody(initialResponse)

  if (initialResponse.status !== 402 || !isPusdPaymentRequiredBody(initialBody)) {
    return {
      status: initialResponse.status,
      headers: collectHeaders(initialResponse.headers),
      body: initialBody,
    }
  }

  if (input.expectedPayment) {
    assertPusdPaymentInstructionMatchesPolicy(
      initialBody,
      input.expectedPayment,
    )
  }
  assertWithinRealPusdCap(initialBody.amount, readRealPusdMaxAmount())

  const payment = await input.deps.owsClient!.payPusdRequest({
    wallet: input.wallet,
    payment: initialBody,
    rpcUrl: process.env.PUSD_SOLANA_RPC_URL,
  })
  if (!payment.signature) {
    throw new Error('OWS did not return a Solana transaction signature.')
  }

  const retryResponse = await fetchWithTimeout(fetch, input.url, {
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
    settlement: {
      rail: PALMOS_PAYMENT_RAIL,
      mode: 'ows',
      amount: initialBody.amount,
      assetSymbol: 'PUSD',
      mint: initialBody.mint,
      network: initialBody.network,
      payer:
        input.deps.owsClient?.getSolanaAddress(input.wallet) ?? input.wallet,
      recipient: initialBody.recipient,
      reference: initialBody.reference,
      signature: payment.signature,
    },
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
  requestSource?: ActionRequestSource
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
    settlementMode: resolveAgentSettlementMode(input.agent),
    amount: input.amount,
    assetSymbol: input.assetSymbol,
    chainId: input.chainId,
    status: 'waiting_for_execution',
    runId: input.runId,
    sessionId: input.sessionId,
    walletId: input.agent.walletId,
    runtimeStatus: input.runtimeStatus,
    runtimePhase: input.runtimePhase,
    requestSource: input.requestSource,
    requestPayload: input.requestPayload,
    requestSummary: input.requestSummary,
    requestUrl: input.requestUrl,
  }
}

function buildServicePayActionRequestRecord(input: {
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
  requestSource?: ActionRequestSource
  requestPayload: Record<string, unknown>
}): ActionRequestRecord {
  const settlementMode = resolveAgentSettlementMode(input.agent)
  const source = input.requestSource ?? 'system'
  return {
    actionRequestId: input.executionId,
    createdAt: input.at,
    updatedAt: input.at,
    agentId: input.agent.agentId,
    organizationId: input.agent.organizationId,
    treasuryId: input.agent.treasuryId,
    walletId: input.agent.walletId,
    source,
    kind: 'service.pay',
    status: 'created',
    target: {
      kind: 'service',
      serviceId: input.serviceId,
      vendorId: input.vendorId,
      endpointUrl: input.requestUrl,
    },
    value: {
      assetSymbol: input.assetSymbol,
      amount: input.amount,
      chainId: input.chainId,
    },
    title: `Service payment ${input.serviceId}`,
    summary: `Requested ${input.amount} ${input.assetSymbol} for ${input.serviceId}.`,
    requestPayload: input.requestPayload,
    requestContext: {
      legacyRecordType: 'PaidCall',
      requestSource: source,
      requestSummary: input.requestSummary,
      paymentRail: input.paymentRail,
      settlementMode,
      intakeStage: 'created',
    },
    policy: {
      approvalRequired: false,
      limitsApplied: {
        legacyRecordType: 'PaidCall',
        paymentRail: input.paymentRail,
        settlementMode,
        intakeStatus: 'created',
      },
    },
    executionPlan: {
      connectorKind: mapActionRequestConnectorKind(input.paymentRail),
      settlementAsset: input.assetSymbol,
      privacyMode: input.paymentRail === 'umbra' ? 'required' : 'off',
      executionMode: settlementMode,
    },
    runtimeRefs: {
      sessionId: input.agent.sessionId,
      intentIds: [],
    },
  }
}

function buildExpectedPusdPaymentInstruction(input: {
  agent: AgentRecord
  vendorId: string
  amount: string
  chainId: string
}): ExpectedPusdPaymentInstruction {
  const vendor = input.agent.policyConfig.allowedVendors.find(
    (candidate) => candidate.vendorId === input.vendorId,
  )
  if (!vendor?.destinationAddress?.trim()) {
    throw new Error(
      `No approved recipient wallet is configured for vendor ${input.vendorId}.`,
    )
  }

  return {
    amount: input.amount,
    recipient: vendor.destinationAddress,
    mint: readPusdMintFromEnv(),
    network: toSolanaCluster(input.chainId),
  }
}

function isRegisteredPalmosService(
  service: PalmosServiceCatalog[string] | X402ServiceCatalog[string],
): service is PalmosServiceCatalog[string] {
  return (
    service.paymentRail === PALMOS_PAYMENT_RAIL &&
    'source' in service &&
    service.source === 'registered'
  )
}

function findAllowedVendorRecipient(input: {
  agent: AgentRecord
  vendorId: string
}): string | undefined {
  return input.agent.policyConfig.allowedVendors.find(
    (candidate) => candidate.vendorId === input.vendorId,
  )?.destinationAddress
}

function readExecutionEndpointAllowlist(
  deps: ExecutePaidServiceCallDependencies,
): string[] {
  return deps.serviceEndpointAllowlist ?? readServiceEndpointAllowlist(process.env)
}

function classifyExecutionError(input: {
  isPalmosRail: boolean
  message: string
}): string {
  const normalized = input.message.toLowerCase()
  if (normalized.includes('redirect')) {
    return 'service.redirect_blocked'
  }

  if (input.isPalmosRail) {
    if (
      normalized.includes('payment instruction') ||
      normalized.includes('approved palmos policy')
    ) {
      return 'palmos.payment_instruction_mismatch'
    }

    if (
      normalized.includes('real-payment cap') ||
      normalized.includes('configured real-payment cap')
    ) {
      return 'palmos.real_payment_cap_exceeded'
    }

    if (normalized.includes('ows')) {
      return 'palmos.ows_payment_failed'
    }

    return 'palmos.execution_failed'
  }

  if (normalized.includes('ows')) {
    return 'x402.ows_payment_failed'
  }

  return 'x402.execution_failed'
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
  const settlementMode = resolveAgentSettlementMode(input.agent)
  const localDemoPosture =
    isPalmosRail && settlementMode === 'local-demo'
      ? readLocalDemoSettlementPosture(deps.env)
      : undefined
  if (localDemoPosture && !localDemoPosture.allowed) {
    const failedRecord: PaidCallRecord = {
      ...input.execution,
      status: 'failed',
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      runtimeStatus: currentRun?.status ?? input.execution.runtimeStatus,
      runtimePhase: currentRun?.currentPhase ?? input.execution.runtimePhase,
      errorCode: 'palmos.local_demo_not_allowed',
      errorMessage: localDemoPosture.reason,
    }
    await deps.paidCalls?.put(failedRecord)
    return {
      kind: 'execution_failed',
      agent: input.agent,
      execution: failedRecord,
      turnOutput: input.turnOutput ?? [],
      error: failedRecord.errorMessage ?? localDemoPosture.reason,
    }
  }
  const shouldRequireRegisteredReadiness =
    isRegisteredPalmosService(service) && settlementMode !== 'local-demo'
  const readiness = isPalmosRail && shouldRequireRegisteredReadiness
    ? await evaluatePalmosServiceReadiness({
        service,
        destinationAddress: findAllowedVendorRecipient({
          agent: input.agent,
          vendorId: service.vendorId,
        }),
        endpointUrl: preparedRequest.url,
        requestedAmount: input.execution.amount,
        requireVerified: shouldRequireRegisteredReadiness,
        requireSafeEndpoint: shouldRequireRegisteredReadiness,
        allowedHostnames: readExecutionEndpointAllowlist(deps),
        lookup: deps.serviceEndpointLookup,
      })
    : undefined
  if (readiness && !readiness.ok) {
    const failedRecord: PaidCallRecord = {
      ...input.execution,
      status: 'failed',
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      runtimeStatus: currentRun?.status ?? input.execution.runtimeStatus,
      runtimePhase: currentRun?.currentPhase ?? input.execution.runtimePhase,
      errorCode: readiness.checks[0]?.code ?? 'service.not_ready',
      errorMessage: formatServiceReadinessFailure(readiness),
    }
    await deps.paidCalls?.put(failedRecord)
    return {
      kind: 'execution_failed',
      agent: input.agent,
      execution: failedRecord,
      turnOutput: input.turnOutput ?? [],
      error: failedRecord.errorMessage ?? 'Paid service is not ready.',
    }
  }

  const owsPayEligible =
    deps.owsClient != null &&
    input.agent.owsWalletName != null &&
    deps.owsClient.supportsPaymentChain(service.chainId) &&
    (!isPalmosRail || settlementMode === 'ows')
  const palmosClientEligible =
    deps.palmosClient != null &&
    (!isPalmosRail ||
      settlementMode === 'local-demo' ||
      settlementMode === 'real-solana')

  if (isPalmosRail && settlementMode === 'ows' && !owsPayEligible) {
    const failedRecord: PaidCallRecord = {
      ...input.execution,
      status: 'failed',
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      runtimeStatus: currentRun?.status ?? input.execution.runtimeStatus,
      runtimePhase: currentRun?.currentPhase ?? input.execution.runtimePhase,
      errorCode: 'palmos.ows_not_configured',
      errorMessage: input.agent.owsWalletName
        ? 'OWS settlement was selected, but the configured OWS client cannot pay this Solana service.'
        : 'OWS settlement was selected, but this agent does not have an attached OWS wallet.',
    }
    await deps.paidCalls?.put(failedRecord)
    return {
      kind: 'execution_failed',
      agent: input.agent,
      execution: failedRecord,
      turnOutput: input.turnOutput ?? [],
      error: failedRecord.errorMessage ?? 'OWS settlement is not configured.',
    }
  }

  if (isPalmosRail && settlementMode !== 'ows' && !palmosClientEligible) {
    const failedRecord: PaidCallRecord = {
      ...input.execution,
      status: 'failed',
      updatedAt: deps.now?.() ?? new Date().toISOString(),
      runtimeStatus: currentRun?.status ?? input.execution.runtimeStatus,
      runtimePhase: currentRun?.currentPhase ?? input.execution.runtimePhase,
      errorCode: 'palmos.client_not_configured',
      errorMessage:
        settlementMode === 'real-solana'
          ? 'Real Solana settlement was selected, but no PalmOS PUSD client is configured.'
          : 'Local service-test settlement was selected, but no PalmOS PUSD client is configured.',
    }
    await deps.paidCalls?.put(failedRecord)
    return {
      kind: 'execution_failed',
      agent: input.agent,
      execution: failedRecord,
      turnOutput: input.turnOutput ?? [],
      error:
        failedRecord.errorMessage ?? 'PalmOS PUSD client is not configured.',
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
    const expectedPusdPayment = isPalmosRail
      ? buildExpectedPusdPaymentInstruction({
          agent: input.agent,
          vendorId: service.vendorId,
          amount: input.execution.amount,
          chainId: service.chainId,
        })
      : undefined
    const response = owsPayEligible
      ? await (async () => {
          if (isPalmosRail) {
            return executePalmosWithOws({
              deps,
              wallet: input.agent.owsWalletName!,
              url: preparedRequest.url,
              init: preparedRequest.init,
              expectedPayment: expectedPusdPayment,
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
          {
            expectedPayment: expectedPusdPayment,
            settlementMode:
              settlementMode === 'real-solana'
                ? 'real-solana'
                : 'local-demo',
          },
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

    const pusdPaymentResponse = isPalmosRail
      ? parsePusdPaymentResponseHeader(response.headers)
      : undefined
    const xPaymentResponse = isPalmosRail
      ? undefined
      : parseXPaymentResponseHeader(response.headers)
    const responseSettlement: PalmosSettlementMetadata | undefined =
      isPalmosRail && 'settlement' in response
        ? (response.settlement as PalmosSettlementMetadata | undefined)
        : undefined
    const transactionSignature =
      pusdPaymentResponse?.transaction ??
      xPaymentResponse?.transaction ??
      responseSettlement?.signature
    const transactionExplorerUrl = isPalmosRail
      ? buildSolscanTransactionUrl(transactionSignature, service.chainId)
      : undefined
    const updatedAt = deps.now?.() ?? new Date().toISOString()
    const refreshedRun = await finalizeRuntimeRunFromPaidExecution({
      deps,
      sessionId: input.execution.sessionId ?? input.agent.sessionId,
      runId: input.execution.runId,
      signatureRequestId,
      transactionHash: transactionSignature,
      status: 'signed',
      summary: isPalmosRail
        ? 'Paid PalmOS PUSD execution succeeded and settlement was observed.'
        : 'Paid x402 execution succeeded and settlement was observed.',
    })

    const executedRecord: PaidCallRecord = {
      ...input.execution,
      status: 'executed',
      updatedAt,
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
      transactionSignature,
      transactionExplorerUrl,
      settlement: buildPaidCallSettlementRecord({
        rail: service.paymentRail,
        mode: isPalmosRail ? responseSettlement?.mode ?? settlementMode : 'x402',
        amount: input.execution.amount,
        assetSymbol: service.assetSymbol,
        network: isPalmosRail
          ? responseSettlement?.network ??
            pusdPaymentResponse?.network ??
            expectedPusdPayment?.network
          : xPaymentResponse?.network,
        mint: isPalmosRail
          ? responseSettlement?.mint ?? expectedPusdPayment?.mint
          : undefined,
        payer: isPalmosRail
          ? responseSettlement?.payer
          : xPaymentResponse?.payer,
        recipient: isPalmosRail
          ? responseSettlement?.recipient ?? expectedPusdPayment?.recipient
          : undefined,
        reference: isPalmosRail
          ? responseSettlement?.reference ?? pusdPaymentResponse?.reference
          : undefined,
        signature: transactionSignature,
        explorerUrl: transactionExplorerUrl,
        confirmedAt: updatedAt,
      }),
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
      errorCode: classifyExecutionError({
        isPalmosRail,
        message,
      }),
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

  if (deps.actionRequests) {
    await deps.actionRequests.put(
      buildServicePayActionRequestRecord({
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
        requestSource: input.source,
      }),
    )
  }

  const settlementMode = resolveAgentSettlementMode(agent)
  const shouldRequireRegisteredReadiness =
    isRegisteredPalmosService(service) && settlementMode !== 'local-demo'
  const readiness =
    service.paymentRail === PALMOS_PAYMENT_RAIL && shouldRequireRegisteredReadiness
      ? await evaluatePalmosServiceReadiness({
          service,
          destinationAddress: findAllowedVendorRecipient({
            agent,
            vendorId: service.vendorId,
          }),
          endpointUrl: preparedRequest.url,
          requestedAmount: amount,
          requireVerified: shouldRequireRegisteredReadiness,
          requireSafeEndpoint: shouldRequireRegisteredReadiness,
          allowedHostnames: readExecutionEndpointAllowlist(deps),
          lookup: deps.serviceEndpointLookup,
        })
      : undefined
  if (readiness && !readiness.ok) {
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
        requestSource: input.source,
      }),
      status: 'blocked',
      errorCode: readiness.checks[0]?.code ?? 'service.not_ready',
      errorMessage: formatServiceReadinessFailure(readiness),
    }
    await deps.paidCalls?.put(blockedRecord)
    return {
      kind: 'blocked',
      agent,
      execution: blockedRecord,
      reason: blockedRecord.errorMessage ?? 'Paid service is not ready.',
    }
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
        requestSource: input.source,
      }),
      status: 'blocked',
      errorCode:
        budgetDecision.reasonCode ?? 'policy.session_budget_exceeded',
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
        requestSource: input.source,
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
    requestSource: input.source,
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
