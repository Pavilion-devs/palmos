/**
 * Records a governed decision + outcome on the Mantle decision log, and stamps the resulting
 * tx/agent refs onto the ActionRequest so the dashboard can surface "Recorded on Mantle".
 *
 * This is the additive Mantle audit layer for the Solana/Byreal settlement spine — it runs AFTER a
 * decision resolves and is strictly BEST-EFFORT: any recorder error is swallowed (the recorder
 * itself never throws), so a Mantle hiccup can never fail a governed swap/LP action. By default the
 * recorder only SIMULATES (gas-free) unless MANTLE_RECORD_LIVE=1.
 *
 * Importantly it records DENIED/blocked actions too — "the agent was stopped on-chain" is the
 * governance money-shot the hackathon rewards (Defining Feature #1: every decision + outcome on-chain).
 */
import type { ActionRequestRecord } from '../store/ActionRequestRegistry.js'
import type { MantleRecorder } from '../integrations/mantle/client.js'

/** The terminal result kinds both orchestrators can produce. */
export type GovernedResultKind =
  | 'blocked'
  | 'approval_pending'
  | 'executed'
  | 'waiting_for_execution'
  | 'execution_failed'

function mapVerdictOutcome(kind: GovernedResultKind): { verdict: string; outcome: string } {
  switch (kind) {
    case 'blocked':
      return { verdict: 'denied', outcome: 'blocked' }
    case 'approval_pending':
      return { verdict: 'approval_required', outcome: 'approval_pending' }
    case 'executed':
      return { verdict: 'auto_approved', outcome: 'executed' }
    case 'waiting_for_execution':
      return { verdict: 'auto_approved', outcome: 'waiting' }
    case 'execution_failed':
      return { verdict: 'auto_approved', outcome: 'failed' }
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Best-effort: record the decision and return the (possibly stamped) ActionRequest. When the
 * recorder is absent/disabled, returns the record unchanged. Never throws.
 */
export async function recordGovernedDecisionOnMantle(input: {
  recorder?: MantleRecorder
  actionRequests: { put(record: ActionRequestRecord): Promise<unknown> }
  actionRequest: ActionRequestRecord
  kind: 'asset.swap' | 'asset.liquidity'
  resultKind: GovernedResultKind
}): Promise<ActionRequestRecord> {
  const { recorder, actionRequest } = input
  if (!recorder?.enabled) return actionRequest

  const { verdict, outcome } = mapVerdictOutcome(input.resultKind)
  const ctx = actionRequest.requestContext ?? {}
  const solanaSignature =
    asString(ctx.settlementSignature) ?? asString(actionRequest.resultRef)
  const reason = actionRequest.errorMessage ? ` | ${actionRequest.errorMessage}` : ''
  const detail = `${actionRequest.title}${reason}`.slice(0, 400)

  let result
  try {
    result = await recorder.recordDecision({
      actionRequestId: actionRequest.actionRequestId,
      kind: input.kind,
      verdict,
      outcome,
      solanaSignature,
      detail,
    })
  } catch {
    // recordDecision is documented best-effort, but guard anyway — never fail the governed action.
    return actionRequest
  }

  const stamped: ActionRequestRecord = {
    ...actionRequest,
    requestContext: {
      ...ctx,
      mantleVerdict: verdict,
      mantleOutcome: outcome,
      mantleAgentId: result.agentId?.toString(),
      mantleActionId: result.actionId,
      mantleRecorded: result.recorded,
      mantleSimulated: result.simulated,
      mantleTxHash: result.txHash,
      mantleTxUrl: result.explorerUrl,
      ...(result.error ? { mantleError: result.error } : {}),
    },
  }
  try {
    await input.actionRequests.put(stamped)
  } catch {
    return actionRequest
  }
  return stamped
}
