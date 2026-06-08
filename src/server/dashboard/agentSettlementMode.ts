import type {
  AgentRecord,
  AgentSettlementMode,
} from '../../store/AgentRegistry.js'
import { isAgentSettlementMode } from '../../store/AgentRegistry.js'
import { readMaybeString } from './shared.js'

export type AgentSettlementModePatch = {
  settlementMode?: AgentSettlementMode
}

export type AgentSettlementModeUpdateResult =
  | {
      ok: true
      agent: AgentRecord
      changed: boolean
      previousSettlementMode?: AgentSettlementMode
      nextSettlementMode: AgentSettlementMode
    }
  | {
      ok: false
      code:
        | 'invalid_settlement_mode'
        | 'archived_agent'
        | 'ows_wallet_required'
      message: string
    }

export function readAgentSettlementModePatch(
  value: unknown,
): AgentSettlementModePatch {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const candidate = value as Record<string, unknown>
  const settlementMode =
    readMaybeString(candidate.settlementMode) ??
    readMaybeString(candidate.walletMode)

  return {
    settlementMode: isAgentSettlementMode(settlementMode)
      ? settlementMode
      : undefined,
  }
}

export function updateAgentSettlementMode(input: {
  agent: AgentRecord
  settlementMode?: AgentSettlementMode
  now?: () => string
}): AgentSettlementModeUpdateResult {
  if (!input.settlementMode) {
    return {
      ok: false,
      code: 'invalid_settlement_mode',
      message:
        'Set settlementMode to one of local-demo, real-solana, or ows.',
    }
  }

  if (input.agent.status === 'archived') {
    return {
      ok: false,
      code: 'archived_agent',
      message: 'Archived agents cannot change settlement mode.',
    }
  }

  if (input.settlementMode === 'ows' && !input.agent.owsWalletName) {
    return {
      ok: false,
      code: 'ows_wallet_required',
      message: 'OWS settlement requires an attached OWS wallet.',
    }
  }

  const previousSettlementMode = input.agent.settlementMode
  const changed = previousSettlementMode !== input.settlementMode

  return {
    ok: true,
    agent: changed
      ? {
          ...input.agent,
          updatedAt: input.now?.() ?? new Date().toISOString(),
          settlementMode: input.settlementMode,
          walletBackend:
            input.settlementMode === 'ows'
              ? 'ows'
              : input.agent.walletBackend === 'ows'
                ? input.agent.walletBackend
                : input.agent.walletBackend,
        }
      : input.agent,
    changed,
    previousSettlementMode,
    nextSettlementMode: input.settlementMode,
  }
}
