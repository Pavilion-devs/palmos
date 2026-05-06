import { createHash } from 'crypto'
import type {
  SimulationEngine,
  SimulationRecord,
  TransferSimulationInput,
} from '../contracts/simulation.js'
import { defaultIdGenerator, defaultNow } from '../runtime/types.js'

type SimulationEngineDependencies = {
  now?: () => string
  createId?: (prefix: string) => string
}

function toFreshnessExpiry(
  simulatedAt: string,
  seconds?: number,
): string | undefined {
  if (!seconds) {
    return undefined
  }

  return new Date(Date.parse(simulatedAt) + seconds * 1000).toISOString()
}

function createResultHash(parts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

export class DeterministicSimulationEngine implements SimulationEngine {
  private readonly now: () => string
  private readonly createId: (prefix: string) => string

  constructor(dependencies: SimulationEngineDependencies = {}) {
    this.now = dependencies.now ?? defaultNow
    this.createId = dependencies.createId ?? defaultIdGenerator
  }

  async simulateTransfer(
    input: TransferSimulationInput,
  ): Promise<SimulationRecord> {
    if (input.intent.action.type !== 'asset.transfer') {
      throw new Error(
        `Deterministic transfer simulation requires an asset.transfer intent, received ${input.intent.action.type}.`,
      )
    }

    const simulatedAt = this.now()
    const payload = input.intent.action.payload
    const invariants = [
      {
        invariantId: 'policy.chain_allowed',
        status: input.resolvedPolicy.scope.allowedChains.includes(payload.chainId)
          ? 'passed'
          : 'failed',
        reason: input.resolvedPolicy.scope.allowedChains.includes(payload.chainId)
          ? undefined
          : `Chain ${payload.chainId} is not in the resolved policy scope.`,
      },
      {
        invariantId: 'policy.asset_allowed',
        status: input.resolvedPolicy.scope.allowedAssets.length === 0 ||
          input.resolvedPolicy.scope.allowedAssets.includes(payload.assetSymbol)
          ? 'passed'
          : 'failed',
        reason:
          input.resolvedPolicy.scope.allowedAssets.length === 0 ||
          input.resolvedPolicy.scope.allowedAssets.includes(payload.assetSymbol)
            ? undefined
            : `Asset ${payload.assetSymbol} is not allowed by resolved policy.`,
      },
      {
        invariantId: 'transfer.amount_positive',
        status: Number(payload.amount) > 0 ? 'passed' : 'failed',
        reason:
          Number(payload.amount) > 0 ? undefined : 'Transfer amount must be positive.',
      },
    ] as const

    const hasFailure = invariants.some(
      (invariant) => invariant.status === 'failed',
    )
    const status = hasFailure ? 'failed' : 'succeeded'
    const expectedAssetDeltas = [
      {
        assetSymbol: payload.assetSymbol,
        amount: payload.amount,
        direction: 'debit' as const,
        address: payload.sourceWalletId,
      },
      {
        assetSymbol: payload.assetSymbol,
        amount: payload.amount,
        direction: 'credit' as const,
        address: payload.destinationAddress,
      },
    ]
    const resultHash = createResultHash({
      materialHash: input.materialHash,
      payload,
      invariants,
      expectedAssetDeltas,
      policyResolutionId: input.resolvedPolicy.resolutionId,
    })

    return {
      simulationId: this.createId('simulation'),
      runId: input.runId,
      simulatedAt,
      status,
      intentRef: {
        intentId: input.intent.intentId,
        version: input.intent.version,
      },
      policyResolutionRef: {
        resolutionId: input.resolvedPolicy.resolutionId,
      },
      summary:
        status === 'succeeded'
          ? `Deterministic simulation predicts a ${payload.amount} ${payload.assetSymbol} transfer on ${payload.chainId}.`
          : 'Deterministic simulation failed one or more invariants.',
      resultHash,
      freshnessExpiresAt: toFreshnessExpiry(
        simulatedAt,
        input.resolvedPolicy.signing.simulationFreshnessSeconds,
      ),
      expectedAssetDeltas,
      invariants: [...invariants],
    }
  }
}
