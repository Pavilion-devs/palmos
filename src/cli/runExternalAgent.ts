import { PalmosAgentClient } from '../sdk/PalmosAgentClient.js'

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

const env = readProcessEnv()
const args = process.argv.slice(2)
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

  if (!targetService.allowed) {
    throw new Error(
      `Service ${serviceId} is not allowed by agent ${me.agent.agentId}'s policy.`,
    )
  }

  const payment = await client.pay({
    serviceId,
    request,
    amount,
    note,
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: 'external_agent_sdk',
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
        payment,
      },
      null,
      2,
    ),
  )
}

void main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'External PalmOS agent run failed.',
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
