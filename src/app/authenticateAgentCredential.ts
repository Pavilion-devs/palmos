import { createHash, timingSafeEqual } from 'crypto'
import type { AgentRecord, AgentRegistry } from '../store/AgentRegistry.js'
import type {
  AgentCredentialRecord,
  AgentCredentialRegistry,
} from '../store/AgentCredentialRegistry.js'

export type AuthenticateAgentCredentialDependencies = {
  credentials: AgentCredentialRegistry
  agentRegistry: AgentRegistry
  now?: () => string
}

export type AuthenticatedAgentCredential = {
  agent: AgentRecord
  credential: AgentCredentialRecord
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function timingSafeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

export async function authenticateAgentCredential(
  deps: AuthenticateAgentCredentialDependencies,
  token: string,
): Promise<AuthenticatedAgentCredential | undefined> {
  const normalizedToken = token.trim()
  if (!normalizedToken.startsWith('palmos_')) {
    return undefined
  }

  const tokenHash = hashToken(normalizedToken)
  const credential = (await deps.credentials.list()).find(
    (record) =>
      record.status === 'active' &&
      record.keyHash.length === tokenHash.length &&
      timingSafeHexEqual(record.keyHash, tokenHash),
  )
  if (!credential) {
    return undefined
  }

  const agent = await deps.agentRegistry.get(credential.agentId)
  if (!agent) {
    return undefined
  }

  const at = deps.now?.() ?? new Date().toISOString()
  const updatedCredential = {
    ...credential,
    updatedAt: at,
    lastUsedAt: at,
  }
  const touched = await deps.credentials.putIfStatus(updatedCredential, 'active')
  if (!touched) {
    return undefined
  }

  // Stamp the agent's heartbeat on every authenticated SDK call, and record the
  // first-connect moment once. This is the real "agent came online" signal the
  // dashboard reads (firstConnectedAt) — distinct from createdAt. The write is
  // best-effort + optimistic so a concurrent update never clobbers other fields
  // and a lost race just defers the heartbeat to the next call.
  const connectedAgent: AgentRecord = {
    ...agent,
    lastCheckInAt: at,
    firstConnectedAt: agent.firstConnectedAt ?? at,
    updatedAt: at,
  }
  await deps.agentRegistry.putIfUpdatedAt(connectedAgent, agent.updatedAt)

  return {
    agent: connectedAgent,
    credential,
  }
}
