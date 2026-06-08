import {
  PALMOS_PAYMENT_RAIL,
  PUSD_SYMBOL,
  SOLANA_MAINNET_CHAIN_ID,
} from './constants.js'
import type { RegisteredPalmosServiceRecord } from '../../store/PalmosServiceRegistry.js'

export type PalmosServiceRequestSpec = {
  url: string
  init?: RequestInit
  requestSummary: Record<string, unknown>
}

export type PalmosPaidServiceDefinition<TRequest = unknown> = {
  serviceId: string
  label: string
  visible?: boolean
  source?: 'built_in' | 'registered'
  verificationStatus?: RegisteredPalmosServiceRecord['verificationStatus']
  paymentRail: typeof PALMOS_PAYMENT_RAIL
  vendorId: string
  chainId: string
  assetSymbol: typeof PUSD_SYMBOL
  expectedAmount: string
  buildRequest(input: TRequest): PalmosServiceRequestSpec
}

export type LocalSpotPriceRequest = {
  baseSymbol?: string
  quoteSymbol?: string
  base?: string
  quote?: string
  symbol?: string
}

export type LocalOpsBriefRequest = {
  symbols?: string[]
  focus?: string
}

export type VendorBriefRequest = {
  vendor?: string
  service?: string
  focus?: string
}

export type LaunchAuditRequest = {
  target?: string
  checks?: string[]
  context?: string
}

export type PalmosServiceCatalog = Record<
  string,
  PalmosPaidServiceDefinition<unknown>
>

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function normalizeSymbol(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

function appendQueryParams(url: URL, request: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(request)) {
    if (value == null) {
      continue
    }

    if (Array.isArray(value)) {
      url.searchParams.set(key, value.map(String).join(','))
      continue
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      url.searchParams.set(key, String(value))
    }
  }
}

export function createLocalPusdSpotPriceService(input?: {
  baseUrl?: string
  expectedAmount?: string
}): PalmosPaidServiceDefinition<LocalSpotPriceRequest> {
  const baseUrl = trimTrailingSlash(input?.baseUrl ?? 'http://127.0.0.1:4021')

  return {
    serviceId: 'local.pusd.spot_price',
    label: 'PUSD Market Data API',
    visible: false,
    paymentRail: PALMOS_PAYMENT_RAIL,
    vendorId: 'local_pusd_demo',
    chainId: SOLANA_MAINNET_CHAIN_ID,
    assetSymbol: PUSD_SYMBOL,
    expectedAmount: input?.expectedAmount ?? '0.01',
    buildRequest(request) {
      const baseSymbol =
        normalizeSymbol(request.baseSymbol) ||
        normalizeSymbol(request.base) ||
        normalizeSymbol(request.symbol) ||
        'SOL'
      const quoteSymbol =
        normalizeSymbol(request.quoteSymbol) || normalizeSymbol(request.quote) || 'USD'
      const url = new URL(`${baseUrl}/api/premium/spot-price`)
      url.searchParams.set('base', baseSymbol)
      url.searchParams.set('quote', quoteSymbol)

      return {
        url: url.toString(),
        init: {
          method: 'GET',
        },
        requestSummary: {
          baseSymbol,
          quoteSymbol,
        },
      }
    },
  }
}

export function createLocalPusdOpsBriefService(input?: {
  baseUrl?: string
  expectedAmount?: string
}): PalmosPaidServiceDefinition<LocalOpsBriefRequest> {
  const baseUrl = trimTrailingSlash(input?.baseUrl ?? 'http://127.0.0.1:4021')

  return {
    serviceId: 'local.pusd.ops_brief',
    label: 'PUSD Ops Brief Vendor',
    visible: false,
    paymentRail: PALMOS_PAYMENT_RAIL,
    vendorId: 'ops_research_vendor',
    chainId: SOLANA_MAINNET_CHAIN_ID,
    assetSymbol: PUSD_SYMBOL,
    expectedAmount: input?.expectedAmount ?? '0.25',
    buildRequest(request) {
      const symbols = request.symbols?.map(normalizeSymbol).filter(Boolean) ?? [
        'BTC',
        'ETH',
        'SOL',
      ]
      const url = new URL(`${baseUrl}/api/premium/ops-brief`)
      url.searchParams.set('symbols', symbols.join(','))
      if (request.focus?.trim()) {
        url.searchParams.set('focus', request.focus.trim())
      }

      return {
        url: url.toString(),
        init: {
          method: 'GET',
        },
        requestSummary: {
          symbols,
          focus: request.focus,
        },
      }
    },
  }
}

export function createPalmosOnchainFlowService(input?: {
  baseUrl?: string
  expectedAmount?: string
}): PalmosPaidServiceDefinition<LocalSpotPriceRequest> {
  const baseUrl = trimTrailingSlash(input?.baseUrl ?? 'http://127.0.0.1:4021')

  return {
    serviceId: 'palmos.intel.onchain_flow',
    label: 'On-Chain Flow Intelligence',
    paymentRail: PALMOS_PAYMENT_RAIL,
    vendorId: 'palmos_intel_vendor',
    chainId: SOLANA_MAINNET_CHAIN_ID,
    assetSymbol: PUSD_SYMBOL,
    expectedAmount: input?.expectedAmount ?? '0.02',
    buildRequest(request) {
      const baseSymbol =
        normalizeSymbol(request.baseSymbol) ||
        normalizeSymbol(request.base) ||
        normalizeSymbol(request.symbol) ||
        'SOL'
      const quoteSymbol =
        normalizeSymbol(request.quoteSymbol) || normalizeSymbol(request.quote) || 'USD'
      const url = new URL(`${baseUrl}/api/premium/onchain-flow`)
      url.searchParams.set('base', baseSymbol)
      url.searchParams.set('quote', quoteSymbol)

      return {
        url: url.toString(),
        init: {
          method: 'GET',
        },
        requestSummary: {
          baseSymbol,
          quoteSymbol,
        },
      }
    },
  }
}

export function createPalmosDefiRiskService(input?: {
  baseUrl?: string
  expectedAmount?: string
}): PalmosPaidServiceDefinition<LocalOpsBriefRequest> {
  const baseUrl = trimTrailingSlash(input?.baseUrl ?? 'http://127.0.0.1:4021')

  return {
    serviceId: 'palmos.research.defi_risk',
    label: 'DeFi Protocol Risk Report',
    paymentRail: PALMOS_PAYMENT_RAIL,
    vendorId: 'palmos_research_vendor',
    chainId: SOLANA_MAINNET_CHAIN_ID,
    assetSymbol: PUSD_SYMBOL,
    expectedAmount: input?.expectedAmount ?? '0.25',
    buildRequest(request) {
      const symbols = request.symbols?.map(normalizeSymbol).filter(Boolean) ?? [
        'SOL',
      ]
      const url = new URL(`${baseUrl}/api/premium/defi-risk`)
      url.searchParams.set('symbols', symbols.join(','))
      if (request.focus?.trim()) {
        url.searchParams.set('focus', request.focus.trim())
      }

      return {
        url: url.toString(),
        init: {
          method: 'GET',
        },
        requestSummary: {
          symbols,
          focus: request.focus,
        },
      }
    },
  }
}

export function createPalmosVendorBriefService(input?: {
  baseUrl?: string
  expectedAmount?: string
}): PalmosPaidServiceDefinition<VendorBriefRequest> {
  const baseUrl = trimTrailingSlash(input?.baseUrl ?? 'http://127.0.0.1:4021')

  return {
    serviceId: 'palmos.ops.vendor_brief',
    label: 'Vendor Ops Brief',
    paymentRail: PALMOS_PAYMENT_RAIL,
    vendorId: 'palmos_ops_vendor',
    chainId: SOLANA_MAINNET_CHAIN_ID,
    assetSymbol: PUSD_SYMBOL,
    expectedAmount: input?.expectedAmount ?? '0.10',
    buildRequest(request) {
      const url = new URL(`${baseUrl}/api/premium/vendor-brief`)
      if (request.vendor?.trim()) {
        url.searchParams.set('vendor', request.vendor.trim())
      }
      if (request.service?.trim()) {
        url.searchParams.set('service', request.service.trim())
      }
      if (request.focus?.trim()) {
        url.searchParams.set('focus', request.focus.trim())
      }

      return {
        url: url.toString(),
        init: {
          method: 'GET',
        },
        requestSummary: {
          vendor: request.vendor,
          service: request.service,
          focus: request.focus,
        },
      }
    },
  }
}

export function createPalmosLaunchAuditService(input?: {
  baseUrl?: string
  expectedAmount?: string
}): PalmosPaidServiceDefinition<LaunchAuditRequest> {
  const baseUrl = trimTrailingSlash(input?.baseUrl ?? 'http://127.0.0.1:4021')

  return {
    serviceId: 'palmos.launch.audit',
    label: 'Production Launch Audit API',
    paymentRail: PALMOS_PAYMENT_RAIL,
    vendorId: 'palmos_launch_auditor',
    chainId: SOLANA_MAINNET_CHAIN_ID,
    assetSymbol: PUSD_SYMBOL,
    expectedAmount: input?.expectedAmount ?? '0.02',
    buildRequest(request) {
      const url = new URL(`${baseUrl}/api/premium/launch-audit`)
      const target = request.target?.trim() || 'https://www.getpalmos.xyz'
      const checks = request.checks?.map((item) => item.trim()).filter(Boolean)

      url.searchParams.set('target', target)
      if (checks?.length) {
        url.searchParams.set('checks', checks.join(','))
      }
      if (request.context?.trim()) {
        url.searchParams.set('context', request.context.trim())
      }

      return {
        url: url.toString(),
        init: {
          method: 'GET',
        },
        requestSummary: {
          target,
          checks: checks?.length ? checks : ['security', 'performance', 'seo', 'api-health'],
          context: request.context,
        },
      }
    },
  }
}

export function createDefaultPalmosServiceCatalog(input?: {
  localDemoBaseUrl?: string
  localDemoSpotPriceAmount?: string
  localDemoOpsBriefAmount?: string
  localDemoVendorBriefAmount?: string
  localDemoLaunchAuditAmount?: string
}): PalmosServiceCatalog {
  const launchAudit = createPalmosLaunchAuditService({
    baseUrl: input?.localDemoBaseUrl,
    expectedAmount: input?.localDemoLaunchAuditAmount,
  }) as PalmosPaidServiceDefinition<unknown>
  const onchainFlow = createPalmosOnchainFlowService({
    baseUrl: input?.localDemoBaseUrl,
    expectedAmount: input?.localDemoSpotPriceAmount,
  }) as PalmosPaidServiceDefinition<unknown>
  const defiRisk = createPalmosDefiRiskService({
    baseUrl: input?.localDemoBaseUrl,
    expectedAmount: input?.localDemoOpsBriefAmount,
  }) as PalmosPaidServiceDefinition<unknown>
  const vendorBrief = createPalmosVendorBriefService({
    baseUrl: input?.localDemoBaseUrl,
    expectedAmount: input?.localDemoVendorBriefAmount,
  }) as PalmosPaidServiceDefinition<unknown>
  const spotPrice = createLocalPusdSpotPriceService({
    baseUrl: input?.localDemoBaseUrl,
    expectedAmount: input?.localDemoSpotPriceAmount,
  }) as PalmosPaidServiceDefinition<unknown>
  const opsBrief = createLocalPusdOpsBriefService({
    baseUrl: input?.localDemoBaseUrl,
    expectedAmount: input?.localDemoOpsBriefAmount,
  }) as PalmosPaidServiceDefinition<unknown>

  return {
    [launchAudit.serviceId]: launchAudit,
    [onchainFlow.serviceId]: onchainFlow,
    [defiRisk.serviceId]: defiRisk,
    [vendorBrief.serviceId]: vendorBrief,
    [spotPrice.serviceId]: spotPrice,
    [opsBrief.serviceId]: opsBrief,
  }
}

export function createRegisteredPalmosServiceDefinition(
  record: RegisteredPalmosServiceRecord,
): PalmosPaidServiceDefinition<Record<string, unknown>> {
  return {
    serviceId: record.serviceId,
    label: record.label,
    source: 'registered',
    verificationStatus: record.verificationStatus ?? 'unchecked',
    paymentRail: PALMOS_PAYMENT_RAIL,
    vendorId: record.vendorId,
    chainId: record.chainId,
    assetSymbol: PUSD_SYMBOL,
    expectedAmount: record.expectedAmount,
    buildRequest(request) {
      const url = new URL(record.endpointUrl)
      const init: RequestInit = {
        method: record.method,
        redirect: 'error',
      }

      if (record.method === 'GET' || record.requestMode === 'query') {
        appendQueryParams(url, request)
      } else {
        init.headers = {
          'content-type': 'application/json',
        }
        init.body = JSON.stringify(request)
      }

      return {
        url: url.toString(),
        init,
        requestSummary: request,
      }
    },
  }
}

export function mergeRegisteredPalmosServices(input: {
  baseCatalog: PalmosServiceCatalog
  services: RegisteredPalmosServiceRecord[]
}): PalmosServiceCatalog {
  const catalog: PalmosServiceCatalog = {
    ...input.baseCatalog,
  }

  for (const service of input.services) {
    if (service.status === 'active') {
      catalog[service.serviceId] = createRegisteredPalmosServiceDefinition(
        service,
      ) as PalmosPaidServiceDefinition<unknown>
    }
  }

  return catalog
}
