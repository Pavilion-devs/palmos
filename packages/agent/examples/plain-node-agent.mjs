import { PalmosAgentClient } from '@getpalmos/agent'

const palmos = PalmosAgentClient.fromEnv()
const serviceId = process.env.PALMOS_SERVICE_ID ?? 'local.pusd.spot_price'
const idempotencyKey =
  process.env.PALMOS_IDEMPOTENCY_KEY ??
  `plain-node-agent:${serviceId}:${new Date().toISOString().slice(0, 10)}`

const result = await palmos.pay({
  serviceId,
  idempotencyKey,
  request: {
    base: process.env.PALMOS_BASE_SYMBOL ?? 'BTC',
    quote: process.env.PALMOS_QUOTE_SYMBOL ?? 'USD',
  },
})

switch (result.result.kind) {
  case 'executed':
    console.log(
      JSON.stringify(
        {
          ok: true,
          status: 'executed',
          executionId: result.result.execution.executionId,
          amount: result.result.execution.amount,
          transactionExplorerUrl: result.result.execution.transactionExplorerUrl,
        },
        null,
        2,
      ),
    )
    break
  case 'approval_pending':
    console.log(
      JSON.stringify(
        {
          ok: true,
          status: 'approval_pending',
          executionId: result.result.execution.executionId,
        },
        null,
        2,
      ),
    )
    break
  case 'blocked':
    console.log(
      JSON.stringify(
        {
          ok: false,
          status: 'blocked',
          executionId: result.result.execution.executionId,
          reason: result.result.reason,
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
    break
  case 'waiting_for_execution':
    console.log(
      JSON.stringify(
        {
          ok: true,
          status: 'waiting_for_execution',
          executionId: result.result.execution.executionId,
        },
        null,
        2,
      ),
    )
    break
  case 'execution_failed':
    console.log(
      JSON.stringify(
        {
          ok: false,
          status: 'execution_failed',
          executionId: result.result.execution.executionId,
          error: result.result.error,
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
    break
}
