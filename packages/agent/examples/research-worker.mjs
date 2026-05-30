import { PalmosAgentClient } from '@getpalmos/agent'

const palmos = PalmosAgentClient.fromEnv()

export async function runResearchWorkerJob(job) {
  const services = await palmos.listServices()
  const service = services.services.find(
    (candidate) => candidate.serviceId === job.serviceId && candidate.allowed,
  )

  if (!service) {
    return {
      ok: false,
      error: `PalmOS service is unavailable or not allowed: ${job.serviceId}`,
    }
  }

  const result = await palmos.pay({
    serviceId: job.serviceId,
    idempotencyKey: `research-worker:${job.jobId}:${job.serviceId}`,
    request: job.request,
    amount: job.amount,
    note: `research-worker:${job.jobId}`,
  })

  return {
    ok: result.result.kind === 'executed',
    jobId: job.jobId,
    kind: result.result.kind,
    executionId: result.result.execution.executionId,
    response:
      result.result.kind === 'executed'
        ? result.result.execution.responsePreview
        : undefined,
    error:
      result.result.kind === 'blocked'
        ? result.result.reason
        : result.result.kind === 'execution_failed'
          ? result.result.error
          : undefined,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = await runResearchWorkerJob({
    jobId: process.env.PALMOS_JOB_ID ?? Date.now().toString(36),
    serviceId: process.env.PALMOS_SERVICE_ID ?? 'local.pusd.spot_price',
    request: {
      base: process.env.PALMOS_BASE_SYMBOL ?? 'BTC',
      quote: process.env.PALMOS_QUOTE_SYMBOL ?? 'USD',
    },
  })
  console.log(JSON.stringify(output, null, 2))
}
