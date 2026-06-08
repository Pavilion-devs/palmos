export const DEFAULT_PAID_SERVICE_TIMEOUT_MS = 15_000
export const DEFAULT_PAID_SERVICE_MAX_RESPONSE_BYTES = 1_000_000

export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number = DEFAULT_PAID_SERVICE_TIMEOUT_MS,
): Promise<Response> {
  const timeout = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.round(timeoutMs))
    : DEFAULT_PAID_SERVICE_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    })
    if (response.redirected) {
      throw new Error('Paid service redirects are blocked by PalmOS.')
    }
    return response
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Paid service request timed out after ${timeout}ms.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function readTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const parsed = Number(contentLength)
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw new Error(
        `Paid service response exceeded ${maxBytes} bytes before body read.`,
      )
    }
  }

  if (!response.body) {
    return response.text()
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (!value) {
      continue
    }

    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      await reader.cancel()
      throw new Error(`Paid service response exceeded ${maxBytes} bytes.`)
    }
    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(body)
}

export async function parseResponseBodyWithLimit(
  response: Response,
  maxBytes: number = DEFAULT_PAID_SERVICE_MAX_RESPONSE_BYTES,
): Promise<unknown> {
  if (response.status === 204) {
    return null
  }

  const text = await readTextWithLimit(response, maxBytes)
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!text) {
    return contentType.includes('application/json') ? null : ''
  }

  if (contentType.includes('application/json')) {
    return JSON.parse(text)
  }

  return text
}
