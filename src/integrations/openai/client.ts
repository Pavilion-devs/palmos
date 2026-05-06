export type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OpenAIChatCompletionRequest = {
  model: string
  messages: OpenAIChatMessage[]
  temperature?: number
  responseFormat?: 'json_object'
}

type ChatCompletionChoice = {
  message?: {
    content?: string | null
  }
}

type ChatCompletionResponse = {
  choices?: ChatCompletionChoice[]
}

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

export class OpenAIClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {}

  static fromEnv(
    env: Record<string, string | undefined> = readProcessEnv(),
  ): OpenAIClient | undefined {
    const apiKey = env.OPENAI_API_KEY?.trim()
    return apiKey ? new OpenAIClient(apiKey) : undefined
  }

  async createChatCompletion(
    request: OpenAIChatCompletionRequest,
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        response_format:
          request.responseFormat === 'json_object'
            ? { type: 'json_object' }
            : undefined,
      }),
    })

    if (!response.ok) {
      throw new Error(
        `OpenAI request failed with status ${response.status}: ${await response.text()}`,
      )
    }

    const body = (await response.json()) as ChatCompletionResponse
    const content = body.choices?.[0]?.message?.content?.trim()
    if (!content) {
      throw new Error('OpenAI returned an empty response.')
    }

    return content
  }
}
