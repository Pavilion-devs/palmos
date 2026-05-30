import { PalmosAgentClient } from '@getpalmos/agent'

const palmos = PalmosAgentClient.fromEnv()

export async function runCodexPaidToolCall(input) {
  const result = await palmos.pay({
    serviceId: input.serviceId,
    idempotencyKey:
      input.idempotencyKey ??
      `codex:${input.serviceId}:${input.workspaceId ?? 'default'}:${input.runId}`,
    request: input.request ?? {},
    amount: input.amount,
    note: input.note ?? 'codex:paid-tool-call',
  })

  if (result.result.kind === 'approval_pending') {
    return {
      ok: false,
      needsApproval: true,
      executionId: result.result.execution.executionId,
    }
  }

  if (result.result.kind !== 'executed') {
    return {
      ok: false,
      needsApproval: false,
      executionId: result.result.execution.executionId,
      kind: result.result.kind,
      error:
        result.result.kind === 'blocked'
          ? result.result.reason
          : result.result.kind === 'execution_failed'
            ? result.result.error
            : 'PalmOS payment did not execute yet.',
    }
  }

  return {
    ok: true,
    executionId: result.result.execution.executionId,
    response: result.result.execution.responsePreview,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = await runCodexPaidToolCall({
    serviceId: process.env.PALMOS_SERVICE_ID ?? 'local.pusd.spot_price',
    runId: process.env.PALMOS_CODEX_RUN_ID ?? Date.now().toString(36),
    request: {
      base: process.env.PALMOS_BASE_SYMBOL ?? 'BTC',
      quote: process.env.PALMOS_QUOTE_SYMBOL ?? 'USD',
    },
  })
  console.log(JSON.stringify(output, null, 2))
}
