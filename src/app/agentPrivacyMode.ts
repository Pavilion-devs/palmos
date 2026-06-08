import type { UmbraPolicyConfig } from '../../runtime/contracts/policy.js'
import type { AgentRecord } from '../store/AgentRegistry.js'
import {
  type AgentPrivacyMode,
  type AgentPolicyTemplateInput,
} from '../policies/compileAgentPolicy.js'

export const AGENT_PRIVACY_MODES = ['disabled', 'allowed', 'required'] as const

export type AgentPrivacyModeUpdateResult =
  | {
      ok: true
      agent: AgentRecord
      changed: boolean
      previousPrivacyMode: AgentPrivacyMode
      nextPrivacyMode: AgentPrivacyMode
    }
  | {
      ok: false
      code: 'invalid_privacy_mode' | 'archived_agent'
      message: string
    }

export function isAgentPrivacyMode(value: unknown): value is AgentPrivacyMode {
  return typeof value === 'string' && AGENT_PRIVACY_MODES.includes(value as AgentPrivacyMode)
}

export function readAgentPrivacyMode(
  policy: Pick<AgentPolicyTemplateInput, 'privacyMode' | 'umbra'>,
): AgentPrivacyMode {
  if (policy.privacyMode) {
    return policy.privacyMode
  }

  return policy.umbra?.mixerRequired ? 'allowed' : 'disabled'
}

export function readAgentPrivacyModeFromInput(value: unknown): AgentPrivacyMode | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  const mode = candidate.privacyMode ?? candidate.privateMode
  return isAgentPrivacyMode(mode) ? mode : undefined
}

function defaultUmbraPolicy(): UmbraPolicyConfig {
  return {
    defaultPath: 'anonymous',
    mixerRequired: true,
    viewingKeyRetention: 'on_request',
    disclosureRecipients: [],
  }
}

export function applyPrivacyModeToPolicy(input: {
  policy: AgentPolicyTemplateInput
  privacyMode: AgentPrivacyMode
}): AgentPolicyTemplateInput {
  if (input.privacyMode === 'disabled') {
    return {
      ...input.policy,
      privacyMode: 'disabled',
      umbra: undefined,
    }
  }

  return {
    ...input.policy,
    privacyMode: input.privacyMode,
    umbra: {
      ...defaultUmbraPolicy(),
      ...input.policy.umbra,
      mixerRequired: true,
    },
  }
}

export function updateAgentPrivacyMode(input: {
  agent: AgentRecord
  privacyMode?: AgentPrivacyMode
  now?: () => string
}): AgentPrivacyModeUpdateResult {
  if (!input.privacyMode) {
    return {
      ok: false,
      code: 'invalid_privacy_mode',
      message: 'Set privacyMode to one of disabled, allowed, or required.',
    }
  }

  if (input.agent.status === 'archived') {
    return {
      ok: false,
      code: 'archived_agent',
      message: 'Archived agents cannot change privacy mode.',
    }
  }

  const previousPrivacyMode = readAgentPrivacyMode(input.agent.policyConfig)
  const changed = previousPrivacyMode !== input.privacyMode

  return {
    ok: true,
    agent: changed
      ? {
          ...input.agent,
          updatedAt: input.now?.() ?? new Date().toISOString(),
          policyConfig: applyPrivacyModeToPolicy({
            policy: input.agent.policyConfig,
            privacyMode: input.privacyMode,
          }),
        }
      : input.agent,
    changed,
    previousPrivacyMode,
    nextPrivacyMode: input.privacyMode,
  }
}

export function requiresPrivateSettlement(input: {
  policy: AgentPolicyTemplateInput
  requestPrivacy?: AgentPrivacyMode | 'default'
}): boolean {
  const mode = readAgentPrivacyMode(input.policy)
  if (mode === 'required') {
    return true
  }

  return input.requestPrivacy === 'required'
}
