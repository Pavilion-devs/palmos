import { createRegisteredPalmosServiceDefinition } from '../../integrations/pusd/serviceCatalog.js'
import type { RegisteredPalmosServiceRecord } from '../../store/PalmosServiceRegistry.js'
import {
  evaluatePalmosServiceReadiness,
  formatServiceReadinessFailure,
  type ServiceReadinessResult,
} from './serviceReadiness.js'
import type { EndpointLookup } from './serviceEndpointSafety.js'

export function setRegisteredPalmosServiceStatus(input: {
  record: RegisteredPalmosServiceRecord
  status: RegisteredPalmosServiceRecord['status']
  now?: () => string
}): RegisteredPalmosServiceRecord {
  return {
    ...input.record,
    status: input.status,
    updatedAt: input.now?.() ?? new Date().toISOString(),
  }
}

export async function verifyRegisteredPalmosServiceRecord(input: {
  record: RegisteredPalmosServiceRecord
  allowedHostnames?: string[]
  lookup?: EndpointLookup
  now?: () => string
}): Promise<{
  record: RegisteredPalmosServiceRecord
  readiness: ServiceReadinessResult
}> {
  const at = input.now?.() ?? new Date().toISOString()
  const verificationCandidate: RegisteredPalmosServiceRecord = {
    ...input.record,
    verificationStatus: 'verified',
  }
  const service = createRegisteredPalmosServiceDefinition(
    verificationCandidate,
  )
  const readiness = await evaluatePalmosServiceReadiness({
    service,
    registeredService: verificationCandidate,
    destinationAddress: input.record.destinationAddress,
    endpointUrl: input.record.endpointUrl,
    requestedAmount: input.record.expectedAmount,
    requireVerified: false,
    requireSafeEndpoint: true,
    allowedHostnames: input.allowedHostnames,
    lookup: input.lookup,
  })

  if (readiness.ok) {
    return {
      readiness,
      record: {
        ...input.record,
        updatedAt: at,
        verificationStatus: 'verified',
        verifiedAt: at,
        lastVerificationError: undefined,
      },
    }
  }

  return {
    readiness,
    record: {
      ...input.record,
      updatedAt: at,
      verificationStatus: 'failed',
      verifiedAt: undefined,
      lastVerificationError: formatServiceReadinessFailure(readiness),
    },
  }
}
