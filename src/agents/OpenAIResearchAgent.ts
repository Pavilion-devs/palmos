import type { AgentRecord } from '../store/AgentRegistry.js'
import type { PalmosServiceCatalog } from '../integrations/pusd/serviceCatalog.js'
import type { X402ServiceCatalog } from '../integrations/x402/serviceCatalog.js'
import { OpenAIClient } from '../integrations/openai/client.js'

type PaidServiceCatalog = PalmosServiceCatalog | X402ServiceCatalog

export type ResearchAgentPlan =
  | {
      kind: 'service_call'
      serviceId: string
      request: Record<string, unknown>
      rationale: string
    }
  | {
      kind: 'no_action'
      rationale: string
    }

export type ResearchAgentAnswer = {
  answer: string
}

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

function getDefaultModel(env: Record<string, string | undefined>): string {
  return env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini'
}

function normalizePlan(value: unknown): ResearchAgentPlan | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  const serviceId =
    typeof record.serviceId === 'string'
      ? record.serviceId
      : typeof record.service === 'string'
        ? record.service
        : undefined
  const kindValue =
    typeof record.kind === 'string'
      ? record.kind
      : typeof record.action === 'string'
        ? record.action
        : undefined
  const rationale =
    typeof record.rationale === 'string'
      ? record.rationale
      : typeof record.reason === 'string'
        ? record.reason
        : 'No rationale provided.'

  if (
    kindValue === 'service_call' ||
    kindValue === 'call_service' ||
    kindValue === 'service_request' ||
    (typeof kindValue === 'string' &&
      typeof serviceId === 'string' &&
      kindValue === serviceId) ||
    (kindValue == null && typeof serviceId === 'string') ||
    (typeof serviceId === 'string' &&
      kindValue !== 'no_action' &&
      kindValue !== 'none' &&
      kindValue !== 'skip')
  ) {
    if (typeof serviceId !== 'string') {
      return undefined
    }

    return {
      kind: 'service_call',
      serviceId,
      request:
        record.request && typeof record.request === 'object'
          ? (record.request as Record<string, unknown>)
          : {},
      rationale,
    }
  }

  if (
    kindValue === 'no_action' ||
    kindValue === 'none' ||
    kindValue === 'skip'
  ) {
    return {
      kind: 'no_action',
      rationale,
    }
  }

  return undefined
}

function buildServiceSummary(serviceCatalog: PaidServiceCatalog): string {
  return Object.values(serviceCatalog)
    .map(
      (service) =>
        `- ${service.serviceId}: ${service.label}; vendor=${service.vendorId}; expectedAmount=${service.expectedAmount} ${service.assetSymbol}; chain=${service.chainId}`,
    )
    .join('\n')
}

function resolveServiceId(
  serviceId: string,
  serviceCatalog: PaidServiceCatalog,
): string {
  if (serviceCatalog[serviceId]) {
    return serviceId
  }

  const normalized = serviceId.trim().toLowerCase()
  const match = Object.values(serviceCatalog).find(
    (service) =>
      service.serviceId.toLowerCase() === normalized ||
      service.vendorId.toLowerCase() === normalized ||
      service.label.toLowerCase() === normalized,
  )

  return match?.serviceId ?? serviceId
}

export class OpenAIResearchAgent {
  constructor(
    private readonly client: OpenAIClient,
    private readonly model: string,
  ) {}

  static fromEnv(
    env: Record<string, string | undefined> = readProcessEnv(),
  ): OpenAIResearchAgent | undefined {
    const client = OpenAIClient.fromEnv(env)
    return client ? new OpenAIResearchAgent(client, getDefaultModel(env)) : undefined
  }

  async planTask(input: {
    agent: AgentRecord
    task: string
    serviceCatalog: PaidServiceCatalog
  }): Promise<ResearchAgentPlan> {
    const content = await this.client.createChatCompletion({
      model: this.model,
      responseFormat: 'json_object',
      messages: [
        {
          role: 'system',
          content:
            'You are a cautious spend-governed research agent. Choose at most one paid service call. Return strict JSON with keys: kind, serviceId, request, rationale. If no service is appropriate, return kind=no_action. For spot-price services, the request must be an object with base and quote keys, for example {\"base\":\"BTC\",\"quote\":\"USD\"}.',
        },
        {
          role: 'user',
          content: [
            `Agent: ${input.agent.displayName}`,
            `Agent wallet type: ${input.agent.walletType}`,
            `Trust tier: ${input.agent.trustTier}`,
            'Allowed services:',
            buildServiceSummary(input.serviceCatalog),
            `Task: ${input.task}`,
            'Use only listed services. Prefer palmos.intel.onchain_flow for simple market intelligence when available.',
          ].join('\n'),
        },
      ],
    })

    const parsed = normalizePlan(JSON.parse(content))
    if (parsed) {
      if (parsed.kind === 'service_call') {
        return {
          ...parsed,
          serviceId: resolveServiceId(parsed.serviceId, input.serviceCatalog),
        }
      }
      return parsed
    }

    throw new Error(`OpenAI returned an invalid research plan: ${content}`)
  }

  async summarizeResult(input: {
    task: string
    serviceResult: unknown
  }): Promise<ResearchAgentAnswer> {
    const content = await this.client.createChatCompletion({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'You are a concise research agent. Summarize the paid tool result for the operator in 2-4 short sentences.',
        },
        {
          role: 'user',
          content: [
            `Task: ${input.task}`,
            `Tool result JSON: ${JSON.stringify(input.serviceResult)}`,
          ].join('\n'),
        },
      ],
    })

    return {
      answer: content,
    }
  }
}
