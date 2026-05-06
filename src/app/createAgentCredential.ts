import { createHash, randomBytes } from 'crypto'
import type {
  AgentCredentialRecord,
  AgentCredentialRegistry,
} from '../store/AgentCredentialRegistry.js'

export type CreateAgentCredentialInput = {
  agentId: string
  label?: string
}

export type CreateAgentCredentialDependencies = {
  credentials: AgentCredentialRegistry
  now?: () => string
  createId?: (prefix: string) => string
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createAgentCredential(
  deps: CreateAgentCredentialDependencies,
  input: CreateAgentCredentialInput,
): Promise<{
  credential: AgentCredentialRecord
  token: string
}> {
  const at = deps.now?.() ?? new Date().toISOString()
  const credentialId = deps.createId?.('agent_key') ?? createId('agent_key')
  const secret = randomBytes(24).toString('base64url')
  const token = `palmos_${input.agentId}_${secret}`
  const credential: AgentCredentialRecord = {
    credentialId,
    agentId: input.agentId,
    createdAt: at,
    updatedAt: at,
    label: input.label ?? 'Default agent key',
    keyPrefix: token.slice(0, 18),
    keyHash: hashToken(token),
    status: 'active',
  }

  await deps.credentials.put(credential)

  return {
    credential,
    token,
  }
}
