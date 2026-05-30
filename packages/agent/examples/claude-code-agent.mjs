import { PalmosAgentClient } from '@getpalmos/agent'

const palmos = PalmosAgentClient.fromEnv()

export async function requestPaidPalmOSService(input = {}) {
  const serviceId = input.serviceId ?? process.env.PALMOS_SERVICE_ID
  if (!serviceId) {
    throw new Error('Set PALMOS_SERVICE_ID or pass serviceId.')
  }

  const result = await palmos.pay({
    serviceId,
    idempotencyKey:
      input.idempotencyKey ??
      `claude-code:${serviceId}:${input.taskId ?? Date.now().toString(36)}`,
    request: input.request ?? {},
    amount: input.amount,
    note: input.note ?? 'claude-code:paid-service-call',
  })

  if (result.result.kind === 'blocked') {
    throw new Error(`PalmOS policy blocked payment: ${result.result.reason}`)
  }

  if (result.result.kind === 'execution_failed') {
    throw new Error(`PalmOS execution failed: ${result.result.error}`)
  }

  return result
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await requestPaidPalmOSService({
    request: {
      base: process.env.PALMOS_BASE_SYMBOL ?? 'BTC',
      quote: process.env.PALMOS_QUOTE_SYMBOL ?? 'USD',
    },
  })
  console.log(JSON.stringify(result, null, 2))
}
