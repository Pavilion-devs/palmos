import type express from 'express'
import {
  authenticateAgentCredential,
  executePaidServiceCall,
  requestAssetTransfer,
} from '../../../index.js'
import { requiresPrivateSettlement } from '../../../app/agentPrivacyMode.js'
import {
  executeUmbraPrivateSettlement,
  readUmbraKeypair,
  readUmbraRuntimeConfig,
  type UmbraAssetSymbol,
} from '../../../integrations/umbra/index.js'
import {
  fetchWithTimeout,
  parseResponseBodyWithLimit,
} from '../../../integrations/pusd/httpSafety.js'
import {
  sendDashboardApiError,
  sendDashboardInternalError,
} from '../apiErrors.js'
import type { DashboardRouteContext } from '../context.js'
import { buildDashboardAgentWalletContext } from '../agentWalletContext.js'
import { stripAgentSecrets } from '../sanitizers.js'
import {
  createSdkIdempotentExecutionId,
  createSdkIdempotentActionRequestId,
  existingActionRequestToSdkResult,
  existingPaidCallToSdkResult,
  isSameSdkIdempotentPayRequest,
  isSameSdkIdempotentTransferRequest,
  normalizeSdkIdempotencyKey,
  readSdkIdempotencyKey,
} from '../sdkIdempotency.js'
import {
  SDK_TOOL_DEFINITIONS,
  buildSdkAgentStatus,
  buildSdkPolicyCheck,
  buildSdkServiceSummaries,
  buildSdkWalletContext,
  isSdkToolName,
  readSdkPolicyCheckInput,
  readSdkToolInput,
  type SdkAuthenticatedAgent,
} from '../sdkTools.js'
import { readAuthToken, readMaybeString, readRecord } from '../shared.js'

async function authenticateSdkRequest(input: {
  req: express.Request
  context: DashboardRouteContext
}): Promise<SdkAuthenticatedAgent | undefined> {
  const token = readAuthToken(input.req)
  if (!token) {
    return undefined
  }

  return authenticateAgentCredential(
    {
      credentials: input.context.workspace.agentCredentialRegistry,
      agentRegistry: input.context.workspace.agentRegistry,
    },
    token,
  )
}

function sendSdkAuthError(
  context: DashboardRouteContext,
  res: express.Response,
): void {
  context.operationalMetrics.increment('sdk.auth_failures')
  sendDashboardApiError(res, 401, {
    code: 'dashboard_access_required',
    message: 'Missing or invalid PalmOS agent credential.',
  })
}

async function buildSdkWalletContextResponse(input: {
  context: DashboardRouteContext
  auth: SdkAuthenticatedAgent
}) {
  const { context, auth } = input
  const agent = auth.agent
  const [wallet, owsAccess] = await Promise.all([
    agent.walletId
      ? context.workspace.walletRegistry.get(agent.walletId)
      : Promise.resolve(undefined),
    context.workspace.owsAccessRegistry.get(agent.agentId),
  ])
  const walletContext = await buildDashboardAgentWalletContext({
    agent,
    wallet,
    owsAccess,
    portfolioReader: context.portfolioReader,
  })
  return buildSdkWalletContext({ agent, walletContext })
}

function asUmbraAssetSymbol(value: string | undefined): UmbraAssetSymbol {
  if (value === 'wSOL' || value === 'dUSDC' || value === 'dUSDT') {
    return value
  }
  return 'wSOL'
}

function readAllowedVendorRecipient(input: {
  auth: SdkAuthenticatedAgent
  vendorId: string
}): string | undefined {
  return input.auth.agent.policyConfig.allowedVendors.find(
    (vendor) => vendor.vendorId === input.vendorId,
  )?.destinationAddress
}

async function executePrivateSdkPayRequest(input: {
  req: express.Request
  res: express.Response
  context: DashboardRouteContext
  auth: SdkAuthenticatedAgent
  serviceId: string
  request: Record<string, unknown>
  amount: string
  note?: string
  idempotencyKey?: string
}): Promise<void> {
  const { res, context, auth, serviceId, request, note, idempotencyKey } = input
  const serviceCatalog = await context.buildPalmosServiceCatalog()
  const service = serviceCatalog[serviceId]
  if (!service) {
    sendDashboardApiError(res, 404, {
      code: 'not_found',
      message: `Unknown PalmOS service: ${serviceId}`,
      details: {
        serviceId,
      },
    })
    return
  }
  if (context.workspace.storageDriver !== 'file') {
    sendDashboardApiError(res, 409, {
      code: 'conflict',
      message:
        'Private SDK settlement is currently enabled for file-backed local/demo workspaces only.',
      details: {
        reason: 'private_settlement_unavailable',
        storageDriver: context.workspace.storageDriver,
      },
    })
    return
  }

  let config: ReturnType<typeof readUmbraRuntimeConfig>
  try {
    config = readUmbraRuntimeConfig(context.env)
  } catch (error) {
    sendDashboardApiError(res, 409, {
      code: 'conflict',
      message:
        error instanceof Error
          ? error.message
          : 'Umbra private settlement is not configured.',
    })
    return
  }

  const destinationAddress =
    context.env.UMBRA_RECIPIENT_ADDRESS?.trim() ??
    readUmbraKeypair(config.secretKeyBase64).publicKey.toBase58()
  if (!destinationAddress) {
    sendDashboardApiError(res, 409, {
      code: 'conflict',
      message:
        'No private settlement recipient is configured.',
      details: {
        reason: 'private_settlement_unavailable',
        serviceId,
        vendorId: service.vendorId,
        publicVendorRecipient: readAllowedVendorRecipient({
          auth,
          vendorId: service.vendorId,
        }),
      },
    })
    return
  }

  const privateAmount =
    context.env.UMBRA_PRIVATE_SERVICE_AMOUNT?.trim() ??
    context.env.UMBRA_PRIVATE_AMOUNT?.trim() ??
    context.env.UMBRA_MIXER_TEST_AMOUNT?.trim() ??
    '0.001'
  const assetSymbol = asUmbraAssetSymbol(context.env.UMBRA_TOKEN?.trim())
  const privateResult = await executeUmbraPrivateSettlement({
    baseDir: context.baseDir,
    agentId: auth.agent.agentId,
    destinationAddress,
    amount: privateAmount,
    assetSymbol,
    config,
    note: note ?? `private:${serviceId}`,
    source: 'sdk',
    requireExistingAgent: true,
  })

  const preparedRequest = service.buildRequest(request as never)
  let responseStatus: number | undefined
  let responseHeaders: Record<string, string> | undefined
  let responsePreview: unknown = privateResult.execution.responsePreview

  if (privateResult.execution.status === 'executed') {
    const response = await fetchWithTimeout(fetch, preparedRequest.url, {
      ...preparedRequest.init,
      headers: new Headers({
        ...(preparedRequest.init?.headers instanceof Headers
          ? Object.fromEntries(preparedRequest.init.headers.entries())
          : {}),
        'x-palmos-private-settlement': privateResult.execution.executionId,
        'x-palmos-private-service': serviceId,
        'x-palmos-private-agent': auth.agent.agentId,
      }),
    })
    responseStatus = response.status
    responseHeaders = Object.fromEntries(response.headers.entries())
    responsePreview = await parseResponseBodyWithLimit(response)
  }

  const updatedExecution = {
    ...privateResult.execution,
    requestSource: 'sdk' as const,
    serviceId,
    vendorId: service.vendorId,
    requestPayload: request,
    requestSummary: {
      ...preparedRequest.requestSummary,
      requestedPrivacy: 'required',
      privateSettlementRail: 'umbra',
      privateSettlementExecutionId: privateResult.execution.executionId,
      originalUmbraServiceId: privateResult.execution.serviceId,
    },
    requestUrl: preparedRequest.url,
    responseStatus,
    responseHeaders,
    responsePreview,
    errorCode:
      responseStatus != null && responseStatus >= 400
        ? `http.${responseStatus}`
        : privateResult.execution.errorCode,
    errorMessage:
      responseStatus != null && responseStatus >= 400
        ? `Private settlement succeeded, but service fulfillment returned HTTP ${responseStatus}.`
        : privateResult.execution.errorMessage,
  }
  await context.workspace.paidCallRegistry.put(updatedExecution)

  res.json({
    ok: true,
    agentId: auth.agent.agentId,
    credentialId: auth.credential.credentialId,
    idempotencyKey,
    idempotentReplay: false,
    result: {
      kind:
        updatedExecution.status === 'executed'
          ? 'executed'
          : updatedExecution.status === 'approval_pending'
            ? 'approval_pending'
            : updatedExecution.status === 'waiting_for_execution'
              ? 'waiting_for_execution'
              : updatedExecution.status === 'blocked'
                ? 'blocked'
                : 'execution_failed',
      agent: stripAgentSecrets(privateResult.agent),
      execution: updatedExecution,
      turnOutput: privateResult.turnOutput,
      reason: privateResult.error,
      error: privateResult.error,
    },
  })
}

const DEFAULT_SDK_WALLET_HISTORY_LIMIT = 20

function readSdkWalletHistoryLimit(value: unknown): number {
  const raw = readMaybeString(Array.isArray(value) ? value[0] : value)
  const parsed = raw ? Number(raw) : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SDK_WALLET_HISTORY_LIMIT
  }
  return Math.min(Math.trunc(parsed), 200)
}

async function buildSdkWalletHistoryResponse(input: {
  req: express.Request
  res: express.Response
  context: DashboardRouteContext
  auth: SdkAuthenticatedAgent
}): Promise<boolean> {
  const { req, res, context, auth } = input
  if (!context.portfolioSnapshotRegistry) {
    sendDashboardApiError(res, 409, {
      code: 'conflict',
      message: 'PortfolioSnapshot registry is not available in this workspace.',
    })
    return false
  }

  const limit = readSdkWalletHistoryLimit(req.query.limit)
  const snapshots = await context.portfolioSnapshotRegistry.listByAgent(
    auth.agent.agentId,
    { limit },
  )
  res.json({
    ok: true,
    agentId: auth.agent.agentId,
    limit,
    snapshots,
  })
  return true
}

async function buildSdkServicesResponse(input: {
  auth: SdkAuthenticatedAgent
  context: DashboardRouteContext
}) {
  const serviceCatalog = await input.context.buildPalmosServiceCatalog()
  return {
    ok: true,
    agentId: input.auth.agent.agentId,
    services: buildSdkServiceSummaries({
      agent: input.auth.agent,
      serviceCatalog,
    }),
  }
}

async function executeSdkPayRequest(input: {
  req: express.Request
  res: express.Response
  context: DashboardRouteContext
  auth: SdkAuthenticatedAgent
}): Promise<void> {
  const { req, res, context, auth } = input
  const body = readSdkToolInput(req.body)
  const serviceId = readMaybeString(body.serviceId)
  if (!serviceId) {
    sendDashboardApiError(res, 400, {
      code: 'invalid_request',
      message: 'Missing serviceId.',
    })
    return
  }

  const serviceCatalog = await context.buildPalmosServiceCatalog()
  if (!serviceCatalog[serviceId]) {
    sendDashboardApiError(res, 404, {
      code: 'not_found',
      message: `Unknown PalmOS service: ${serviceId}`,
      details: {
        serviceId,
      },
    })
    return
  }
  const service = serviceCatalog[serviceId]
  const request = readRecord(body.request)
  const amount = readMaybeString(body.amount) ?? service.expectedAmount
  const privacy = readMaybeString(body.privacy)
  if (
    requiresPrivateSettlement({
      policy: auth.agent.policyConfig,
      requestPrivacy: privacy === 'required' ? 'required' : 'default',
    })
  ) {
    await executePrivateSdkPayRequest({
      req,
      res,
      context,
      auth,
      serviceId,
      request,
      amount,
      note: readMaybeString(body.note),
      idempotencyKey:
        readSdkIdempotencyKey(req) ?? normalizeSdkIdempotencyKey(body.idempotencyKey),
    })
    return
  }
  const idempotencyKey =
    readSdkIdempotencyKey(req) ?? normalizeSdkIdempotencyKey(body.idempotencyKey)
  const idempotentExecutionId = idempotencyKey
    ? createSdkIdempotentExecutionId({
        agentId: auth.agent.agentId,
        idempotencyKey,
      })
    : undefined
  const existingExecution = idempotentExecutionId
    ? await context.workspace.paidCallRegistry.get(idempotentExecutionId)
    : undefined

  if (existingExecution) {
    if (
      !isSameSdkIdempotentPayRequest({
        execution: existingExecution,
        serviceId,
        amount,
        request,
      })
    ) {
      sendDashboardApiError(res, 409, {
        code: 'conflict',
        message:
          'Idempotency key was already used for a different SDK payment request.',
        details: {
          executionId: existingExecution.executionId,
          idempotencyKey,
        },
      })
      return
    }

    res.setHeader('Idempotency-Replayed', 'true')
    res.json({
      ok: true,
      agentId: auth.agent.agentId,
      credentialId: auth.credential.credentialId,
      idempotencyKey,
      idempotentReplay: true,
      result: {
        ...existingPaidCallToSdkResult({
          agent: auth.agent,
          execution: existingExecution,
        }),
        agent: stripAgentSecrets(auth.agent),
      },
    })
    return
  }

  const result = await executePaidServiceCall(
    {
      kernel: context.workspace.kernel,
      agentRegistry: context.workspace.agentRegistry,
      actionRequests: context.workspace.actionRequestRegistry,
      paidCalls: context.workspace.paidCallRegistry,
      palmosClient: context.palmosClient,
      owsClient: context.owsClient,
      serviceCatalog,
      xmtpNotifier: context.xmtpNotifier,
      createId: idempotentExecutionId ? () => idempotentExecutionId : undefined,
      env: context.env,
    },
    {
      agentId: auth.agent.agentId,
      serviceId,
      request,
      amount,
      note: readMaybeString(body.note),
      source: 'sdk',
    },
  )

  if (result.kind === 'blocked') {
    context.operationalMetrics.increment('sdk.policy_denials')
    sendDashboardApiError(res, 403, {
      code: 'policy_denied',
      message: result.reason,
      details: {
        agentId: auth.agent.agentId,
        credentialId: auth.credential.credentialId,
        result: {
          ...result,
          agent: stripAgentSecrets(result.agent),
        },
      },
    })
    return
  }

  res.json({
    ok: true,
    agentId: auth.agent.agentId,
    credentialId: auth.credential.credentialId,
    idempotencyKey,
    idempotentReplay: false,
    result: {
      ...result,
      agent: stripAgentSecrets(result.agent),
    },
  })
}

async function executeSdkAssetTransferRequest(input: {
  req: express.Request
  res: express.Response
  context: DashboardRouteContext
  auth: SdkAuthenticatedAgent
}): Promise<void> {
  const { req, res, context, auth } = input
  const body = readSdkToolInput(req.body)
  const destinationAddress = readMaybeString(body.destinationAddress)
  const chainId = readMaybeString(body.chainId)
  const assetSymbol = readMaybeString(body.assetSymbol)
  const amount = readMaybeString(body.amount)

  if (!destinationAddress || !chainId || !assetSymbol || !amount) {
    sendDashboardApiError(res, 400, {
      code: 'invalid_request',
      message:
        'Missing destinationAddress, chainId, assetSymbol, or amount for asset transfer.',
    })
    return
  }

  if (!context.workspace.actionRequestRegistry) {
    sendDashboardApiError(res, 409, {
      code: 'conflict',
      message: 'ActionRequest registry is not available in this workspace.',
    })
    return
  }

  const counterpartyId = readMaybeString(body.counterpartyId)
  const note = readMaybeString(body.note)
  const idempotencyKey =
    readSdkIdempotencyKey(req) ?? normalizeSdkIdempotencyKey(body.idempotencyKey)
  const idempotentActionRequestId = idempotencyKey
    ? createSdkIdempotentActionRequestId({
        agentId: auth.agent.agentId,
        idempotencyKey,
      })
    : undefined
  const existingActionRequest = idempotentActionRequestId
    ? await context.workspace.actionRequestRegistry.get(idempotentActionRequestId)
    : undefined

  if (existingActionRequest) {
    if (
      !isSameSdkIdempotentTransferRequest({
        actionRequest: existingActionRequest,
        destinationAddress,
        chainId,
        assetSymbol,
        amount,
        counterpartyId,
        note,
      })
    ) {
      sendDashboardApiError(res, 409, {
        code: 'conflict',
        message:
          'Idempotency key was already used for a different SDK asset transfer request.',
        details: {
          actionRequestId: existingActionRequest.actionRequestId,
          idempotencyKey,
        },
      })
      return
    }

    res.setHeader('Idempotency-Replayed', 'true')
    res.json({
      ok: true,
      agentId: auth.agent.agentId,
      credentialId: auth.credential.credentialId,
      idempotencyKey,
      idempotentReplay: true,
      result: {
        ...existingActionRequestToSdkResult({
          agent: auth.agent,
          actionRequest: existingActionRequest,
        }),
        agent: stripAgentSecrets(auth.agent),
      },
    })
    return
  }

  const result = await requestAssetTransfer(
    {
      kernel: context.workspace.kernel,
      agentRegistry: context.workspace.agentRegistry,
      actionRequests: context.workspace.actionRequestRegistry,
      createId: idempotentActionRequestId
        ? (prefix) =>
            prefix === 'action_request'
              ? idempotentActionRequestId
              : `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
        : undefined,
    },
    {
      agentId: auth.agent.agentId,
      destinationAddress,
      chainId,
      assetSymbol,
      amount,
      counterpartyId,
      note,
      source: 'sdk',
    },
  )

  if (result.kind === 'blocked') {
    context.operationalMetrics.increment('sdk.policy_denials')
    sendDashboardApiError(res, 403, {
      code: 'policy_denied',
      message: result.reason,
      details: {
        agentId: auth.agent.agentId,
        credentialId: auth.credential.credentialId,
        result: {
          ...result,
          agent: stripAgentSecrets(result.agent),
        },
      },
    })
    return
  }

  res.json({
    ok: true,
    agentId: auth.agent.agentId,
    credentialId: auth.credential.credentialId,
    idempotencyKey,
    idempotentReplay: false,
    result: {
      ...result,
      agent: stripAgentSecrets(result.agent),
    },
  })
}

export function registerSdkRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.get('/api/sdk/v1/me', async (req, res) => {
    context.operationalMetrics.increment('sdk.calls')
    const auth = await authenticateSdkRequest({ req, context })
    if (!auth) {
      sendSdkAuthError(context, res)
      return
    }

    res.json(buildSdkAgentStatus(auth))
  })

  app.get('/api/sdk/v1/wallet', async (req, res) => {
    context.operationalMetrics.increment('sdk.calls')
    try {
      const auth = await authenticateSdkRequest({ req, context })
      if (!auth) {
        sendSdkAuthError(context, res)
        return
      }

      res.json(await buildSdkWalletContextResponse({ context, auth }))
    } catch (error) {
      context.operationalMetrics.increment('sdk.internal_failures')
      console.error('[DashboardApi] SDK wallet context request failed', error)
      sendDashboardInternalError(
        res,
        'Unable to build PalmOS agent wallet context.',
      )
    }
  })

  app.get('/api/sdk/v1/wallet/history', async (req, res) => {
    context.operationalMetrics.increment('sdk.calls')
    try {
      const auth = await authenticateSdkRequest({ req, context })
      if (!auth) {
        sendSdkAuthError(context, res)
        return
      }

      await buildSdkWalletHistoryResponse({ req, res, context, auth })
    } catch (error) {
      context.operationalMetrics.increment('sdk.internal_failures')
      console.error('[DashboardApi] SDK wallet history request failed', error)
      sendDashboardInternalError(
        res,
        'Unable to read PalmOS agent portfolio history.',
      )
    }
  })

  app.get('/api/sdk/v1/services', async (req, res) => {
    context.operationalMetrics.increment('sdk.calls')
    const auth = await authenticateSdkRequest({ req, context })
    if (!auth) {
      sendSdkAuthError(context, res)
      return
    }

    res.json(await buildSdkServicesResponse({ auth, context }))
  })

  app.get('/api/sdk/v1/tools', async (req, res) => {
    context.operationalMetrics.increment('sdk.calls')
    const auth = await authenticateSdkRequest({ req, context })
    if (!auth) {
      sendSdkAuthError(context, res)
      return
    }

    res.json({
      ok: true,
      agentId: auth.agent.agentId,
      tools: SDK_TOOL_DEFINITIONS,
    })
  })

  app.post('/api/sdk/v1/tools/:toolName', async (req, res) => {
    context.operationalMetrics.increment('sdk.calls')
    try {
      const auth = await authenticateSdkRequest({ req, context })
      if (!auth) {
        sendSdkAuthError(context, res)
        return
      }

      const toolName = req.params.toolName
      if (!toolName || !isSdkToolName(toolName)) {
        sendDashboardApiError(res, 404, {
          code: 'not_found',
          message: `Unknown PalmOS SDK tool: ${toolName ?? 'unknown'}`,
        })
        return
      }

      if (toolName === 'list_services') {
        res.json(await buildSdkServicesResponse({ auth, context }))
        return
      }

      if (toolName === 'get_agent_status') {
        res.json(buildSdkAgentStatus(auth))
        return
      }

      if (toolName === 'get_wallet_context') {
        res.json(await buildSdkWalletContextResponse({ context, auth }))
        return
      }

      if (toolName === 'check_policy') {
        const policyInput = readSdkPolicyCheckInput(req.body)
        if (!policyInput.serviceId) {
          sendDashboardApiError(res, 400, {
            code: 'invalid_request',
            message: 'Missing serviceId.',
          })
          return
        }

        const serviceCatalog = await context.buildPalmosServiceCatalog()
        const policyCheck = buildSdkPolicyCheck({
          agent: auth.agent,
          serviceCatalog,
          serviceId: policyInput.serviceId,
          amount: policyInput.amount,
        })
        if (!policyCheck) {
          sendDashboardApiError(res, 404, {
            code: 'not_found',
            message: `Unknown PalmOS service: ${policyInput.serviceId}`,
            details: {
              serviceId: policyInput.serviceId,
            },
          })
          return
        }

        res.json(policyCheck)
        return
      }

      if (toolName === 'request_asset_transfer') {
        await executeSdkAssetTransferRequest({ req, res, context, auth })
        return
      }

      await executeSdkPayRequest({ req, res, context, auth })
    } catch (error) {
      context.operationalMetrics.increment('sdk.internal_failures')
      console.error('[DashboardApi] SDK tool request failed', error)
      sendDashboardInternalError(res, 'Unable to execute PalmOS SDK tool request.')
    }
  })

  app.post('/api/sdk/v1/pay', async (req, res) => {
    context.operationalMetrics.increment('sdk.calls')
    try {
      const auth = await authenticateSdkRequest({ req, context })
      if (!auth) {
        sendSdkAuthError(context, res)
        return
      }

      await executeSdkPayRequest({ req, res, context, auth })
    } catch (error) {
      context.operationalMetrics.increment('sdk.internal_failures')
      console.error('[DashboardApi] SDK payment request failed', error)
      sendDashboardInternalError(
        res,
        'Unable to execute PalmOS SDK payment request.',
      )
    }
  })
}
