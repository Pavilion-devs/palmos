import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'
import type {
  RuntimeEnvironment,
  WalletLifecycleState,
} from '../../runtime/index.js'
import type { AgentPolicyTemplateInput } from '../policies/compileAgentPolicy.js'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type AgentTrustTier = 'new' | 'healthy' | 'trusted' | 'restricted'

export type AgentStatus =
  | 'draft'
  | 'wallet_pending'
  | 'ready'
  | 'approval_pending'
  | 'restricted'
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
  xmtpInboxId?: string
}

export interface AgentRegistry {
  get(agentId: string): Promise<AgentRecord | undefined>
  put(agent: AgentRecord): Promise<void>
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

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const contents = await readFile(path, 'utf8')
    return JSON.parse(contents) as T
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined
    }

    throw error
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
    await writeFile(
      getAgentFilePath(agent.agentId, this.baseDir),
      JSON.stringify(agent, null, 2),
      'utf8',
    )
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
