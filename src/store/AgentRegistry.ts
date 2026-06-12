import { mkdir, readdir, rm, rmdir } from 'fs/promises'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'
import { readJsonFile, writeJsonFile } from '../../runtime/runtime/jsonFile.js'
import type {
  RuntimeEnvironment,
  WalletLifecycleState,
} from '../../runtime/index.js'
import type { AgentPolicyTemplateInput } from '../policies/compileAgentPolicy.js'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type AgentTrustTier = 'new' | 'healthy' | 'trusted' | 'restricted'

export type AgentSettlementMode = 'local-demo' | 'ows' | 'real-solana'

export type AgentStatus =
  | 'draft'
  | 'wallet_pending'
  | 'ready'
  | 'approval_pending'
  | 'restricted'
  | 'suspended'
  | 'archived'
  | 'stale'
  | 'failed'

export type AgentRecord = {
  agentId: string
  createdAt: string
  updatedAt: string
  displayName: string
  organizationId: string
  treasuryId?: string
  environment: RuntimeEnvironment
  actorId: string
  sessionId: string
  walletType: AgentPolicyTemplateInput['walletType']
  settlementMode?: AgentSettlementMode
  walletId?: string
  walletState?: WalletLifecycleState
  signerProfileId?: string
  policyProfileId?: string
  walletBackend?: 'runtime' | 'ows'
  owsWalletId?: string
  owsWalletName?: string
  owsApiKeyId?: string
  owsVaultPath?: string
  policyConfig: AgentPolicyTemplateInput
  trustTier: AgentTrustTier
  status: AgentStatus
  lastCheckInAt: string
  // First time the agent actually authenticated via the SDK (its real "came
  // online" moment). Unset until the agent runs with its token — distinct from
  // createdAt, which is when the operator provisioned the agent + wallet.
  firstConnectedAt?: string
  // First time a positive portfolio balance was observed for this wallet (its
  // funding moment), stamped once at snapshot-capture time. Inbound deposits are
  // external on-chain credits, not governed actions, so this is how funding
  // surfaces on the dashboard. firstFundedValueUsd records the observed amount.
  firstFundedAt?: string
  firstFundedValueUsd?: number
  xmtpInboxId?: string
}

export function isAgentSettlementMode(
  value: string | undefined,
): value is AgentSettlementMode {
  return value === 'local-demo' || value === 'ows' || value === 'real-solana'
}

export function normalizeAgentSettlementMode(
  value: string | undefined,
  fallback: AgentSettlementMode = 'local-demo',
): AgentSettlementMode {
  return isAgentSettlementMode(value) ? value : fallback
}

export interface AgentRegistry {
  get(agentId: string): Promise<AgentRecord | undefined>
  put(agent: AgentRecord): Promise<void>
  putIfUpdatedAt(agent: AgentRecord, expectedUpdatedAt: string): Promise<boolean>
  list(): Promise<AgentRecord[]>
  getByActorId(actorId: string): Promise<AgentRecord | undefined>
  getByWalletId(walletId: string): Promise<AgentRecord | undefined>
  remove(agentId: string): Promise<void>
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getAgentsDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'agents')
}

function getAgentFilePath(agentId: string, baseDir?: string): string {
  return join(getAgentsDir(baseDir), `${agentId}.json`)
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquireAgentFileLock(lockDir: string): Promise<void> {
  const startedAt = Date.now()
  while (true) {
    try {
      await mkdir(lockDir)
      return
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'EEXIST' &&
        Date.now() - startedAt < 5_000
      ) {
        await wait(25)
        continue
      }
      throw error
    }
  }
}

export class InMemoryAgentRegistry implements AgentRegistry {
  private readonly agents = new Map<string, AgentRecord>()

  constructor(seedAgents: AgentRecord[] = []) {
    for (const agent of seedAgents) {
      this.agents.set(agent.agentId, agent)
    }
  }

  async get(agentId: string): Promise<AgentRecord | undefined> {
    return this.agents.get(agentId)
  }

  async put(agent: AgentRecord): Promise<void> {
    this.agents.set(agent.agentId, agent)
  }

  async putIfUpdatedAt(
    agent: AgentRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    const current = this.agents.get(agent.agentId)
    if (current?.updatedAt !== expectedUpdatedAt) {
      return false
    }
    this.agents.set(agent.agentId, agent)
    return true
  }

  async list(): Promise<AgentRecord[]> {
    return [...this.agents.values()]
  }

  async getByActorId(actorId: string): Promise<AgentRecord | undefined> {
    return (await this.list()).find((agent) => agent.actorId === actorId)
  }

  async getByWalletId(walletId: string): Promise<AgentRecord | undefined> {
    return (await this.list()).find((agent) => agent.walletId === walletId)
  }

  async remove(agentId: string): Promise<void> {
    this.agents.delete(agentId)
  }
}

export class FileAgentRegistry implements AgentRegistry {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async get(agentId: string): Promise<AgentRecord | undefined> {
    return readJsonFile<AgentRecord>(getAgentFilePath(agentId, this.baseDir))
  }

  async put(agent: AgentRecord): Promise<void> {
    await mkdir(getAgentsDir(this.baseDir), { recursive: true })
    await writeJsonFile(getAgentFilePath(agent.agentId, this.baseDir), agent)
  }

  async putIfUpdatedAt(
    agent: AgentRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    await mkdir(getAgentsDir(this.baseDir), { recursive: true })
    const lockDir = `${getAgentFilePath(agent.agentId, this.baseDir)}.lock`
    await acquireAgentFileLock(lockDir)
    try {
      const current = await this.get(agent.agentId)
      if (current?.updatedAt !== expectedUpdatedAt) {
        return false
      }
      await writeJsonFile(getAgentFilePath(agent.agentId, this.baseDir), agent)
      return true
    } finally {
      await rmdir(lockDir).catch(() => undefined)
    }
  }

  async list(): Promise<AgentRecord[]> {
    try {
      const entries = await readdir(getAgentsDir(this.baseDir), {
        withFileTypes: true,
      })
      const agents = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<AgentRecord>(join(getAgentsDir(this.baseDir), entry.name)),
          ),
      )
      return agents.filter((agent): agent is AgentRecord => Boolean(agent))
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return []
      }

      throw error
    }
  }

  async getByActorId(actorId: string): Promise<AgentRecord | undefined> {
    return (await this.list()).find((agent) => agent.actorId === actorId)
  }

  async getByWalletId(walletId: string): Promise<AgentRecord | undefined> {
    return (await this.list()).find((agent) => agent.walletId === walletId)
  }

  async remove(agentId: string): Promise<void> {
    await rm(getAgentFilePath(agentId, this.baseDir), { force: true })
  }
}
