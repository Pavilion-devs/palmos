import type {
  ReconciliationInput,
  ReconciliationReport,
  Reconciler,
} from '../contracts/reconciliation.js'
import { defaultIdGenerator, defaultNow } from '../runtime/types.js'

type ReconcilerDependencies = {
  now?: () => string
  createId?: (prefix: string) => string
}

export class DeterministicReconciler implements Reconciler {
  private readonly now: () => string
  private readonly createId: (prefix: string) => string

  constructor(dependencies: ReconcilerDependencies = {}) {
    this.now = dependencies.now ?? defaultNow
    this.createId = dependencies.createId ?? defaultIdGenerator
  }

  async reconcileTransfer(
    input: ReconciliationInput,
  ): Promise<ReconciliationReport> {
    const transferPayload =
      input.intent.action.type === 'asset.transfer'
        ? input.intent.action.payload
        : undefined
    const checks = [
      {
        checkId: 'reconciliation.transaction_hash_present',
        status: input.broadcast.transactionHash ? 'passed' : 'failed',
        reason: input.broadcast.transactionHash
          ? undefined
          : 'No transaction hash present on broadcast record.',
      },
      {
        checkId: 'reconciliation.asset_amount_matches_simulation',
        status:
          transferPayload != null &&
          input.simulation.expectedAssetDeltas.some(
            (delta) =>
              delta.direction === 'credit' &&
              delta.amount === transferPayload.amount &&
              delta.assetSymbol === transferPayload.assetSymbol,
          )
            ? 'passed'
            : 'failed',
        reason:
          transferPayload != null &&
          input.simulation.expectedAssetDeltas.some(
            (delta) =>
              delta.direction === 'credit' &&
              delta.amount === transferPayload.amount &&
              delta.assetSymbol === transferPayload.assetSymbol,
          )
            ? undefined
            : 'Simulated asset deltas do not match the transfer intent.',
      },
    ] as const

    const hasFailure = checks.some((check) => check.status === 'failed')
    return {
      reconciliationId: this.createId('reconciliation'),
      runId: input.runId,
      completedAt: this.now(),
      status: hasFailure ? 'mismatch' : 'matched',
      observedTransactionHash:
        input.broadcast.transactionHash ?? input.signatureResult.transactionHash,
      summary: hasFailure
        ? 'Reconciliation detected a mismatch.'
        : 'Reconciliation matched the expected transfer effects.',
      checks: [...checks],
    }
  }
}
