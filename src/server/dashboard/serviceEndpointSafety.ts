import { lookup } from 'dns/promises'
import { isIP } from 'net'

export type EndpointLookupResult = {
  address: string
  family: 4 | 6
}

export type EndpointLookup = (
  hostname: string,
) => Promise<EndpointLookupResult[]>

export type EndpointSafetyResult =
  | {
      ok: true
      url: URL
      resolvedAddresses: EndpointLookupResult[]
    }
  | {
      ok: false
      reason:
        | 'invalid_url'
        | 'unsupported_protocol'
        | 'blocked_hostname'
        | 'blocked_ip'
        | 'dns_lookup_failed'
        | 'no_dns_records'
        | 'hostname_not_allowlisted'
    }

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

export function readServiceEndpointAllowlist(
  env: Record<string, string | undefined>,
): string[] {
  return (env.PALMOS_SERVICE_ENDPOINT_ALLOWLIST ?? '')
    .split(/[\s,]+/g)
    .map((value) => value.trim())
    .filter(Boolean)
}

export function isEndpointHostnameAllowlisted(
  hostname: string,
  allowedHostnames: string[] | undefined,
): boolean {
  if (!allowedHostnames || allowedHostnames.length === 0) {
    return true
  }

  const normalizedHostname = normalizeHostname(hostname)
  return allowedHostnames.some((allowed) => {
    let allowedHostname = allowed
    if (allowed.includes('://')) {
      try {
        allowedHostname = new URL(allowed).hostname
      } catch {
        return false
      }
    }
    const normalizedAllowed = normalizeHostname(allowedHostname)
    if (normalizedAllowed.startsWith('*.')) {
      const suffix = normalizedAllowed.slice(2)
      return normalizedHostname.endsWith(`.${suffix}`)
    }

    return normalizedHostname === normalizedAllowed
  })
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false
  }

  const [first = 0, second = 0] = parts
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  )
}

function isUnsafeIpv6(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('ff')
  )
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  return (
    normalized === 'localhost' ||
    normalized === 'metadata' ||
    normalized === 'metadata.google.internal' ||
    normalized === '169.254.169.254' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.internal')
  )
}

function isUnsafeIpAddress(address: string): boolean {
  const normalized = normalizeHostname(address)
  const ipVersion = isIP(normalized)
  if (ipVersion === 4) {
    return isPrivateIpv4(normalized)
  }
  if (ipVersion === 6) {
    return isUnsafeIpv6(normalized)
  }

  return false
}

async function defaultLookup(hostname: string): Promise<EndpointLookupResult[]> {
  const records = await lookup(hostname, {
    all: true,
    verbatim: true,
  })

  return records
    .filter((record) => record.family === 4 || record.family === 6)
    .map((record) => ({
      address: record.address,
      family: record.family as 4 | 6,
    }))
}

export async function validateRegisteredServiceEndpoint(input: {
  endpointUrl: string
  lookup?: EndpointLookup
  allowedHostnames?: string[]
}): Promise<EndpointSafetyResult> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(input.endpointUrl)
  } catch {
    return {
      ok: false,
      reason: 'invalid_url',
    }
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'unsupported_protocol',
    }
  }

  const hostname = normalizeHostname(parsedUrl.hostname)
  if (!isEndpointHostnameAllowlisted(hostname, input.allowedHostnames)) {
    return {
      ok: false,
      reason: 'hostname_not_allowlisted',
    }
  }

  if (isBlockedHostname(hostname)) {
    return {
      ok: false,
      reason: 'blocked_hostname',
    }
  }

  const ipVersion = isIP(hostname)
  if (ipVersion !== 0) {
    if (isUnsafeIpAddress(hostname)) {
      return {
        ok: false,
        reason: 'blocked_ip',
      }
    }

    return {
      ok: true,
      url: parsedUrl,
      resolvedAddresses: [
        {
          address: hostname,
          family: ipVersion as 4 | 6,
        },
      ],
    }
  }

  let resolvedAddresses: EndpointLookupResult[]
  try {
    resolvedAddresses = await (input.lookup ?? defaultLookup)(hostname)
  } catch {
    return {
      ok: false,
      reason: 'dns_lookup_failed',
    }
  }

  if (resolvedAddresses.length === 0) {
    return {
      ok: false,
      reason: 'no_dns_records',
    }
  }

  if (resolvedAddresses.some((record) => isUnsafeIpAddress(record.address))) {
    return {
      ok: false,
      reason: 'blocked_ip',
    }
  }

  return {
    ok: true,
    url: parsedUrl,
    resolvedAddresses,
  }
}
