import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type AgentCredentialRecord = {
  credentialId: string
  agentId: string
  createdAt: string
  updatedAt: string
  label: string
  keyPrefix: string
  keyHash: string
  status: 'active' | 'revoked'
  lastUsedAt?: string
}

export interface AgentCredentialRegistry {
  get(credentialId: string): Promise<AgentCredentialRecord | undefined>
  put(record: AgentCredentialRecord): Promise<void>
  list(): Promise<AgentCredentialRecord[]>
  listByAgent(agentId: string): Promise<AgentCredentialRecord[]>
  remove(credentialId: string): Promise<void>
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getCredentialsDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'agent-credentials')
}

function getCredentialFilePath(credentialId: string, baseDir?: string): string {
  return join(getCredentialsDir(baseDir), `${credentialId}.json`)
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

export class FileAgentCredentialRegistry implements AgentCredentialRegistry {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async get(credentialId: string): Promise<AgentCredentialRecord | undefined> {
    return readJsonFile<AgentCredentialRecord>(
      getCredentialFilePath(credentialId, this.baseDir),
    )
  }

  async put(record: AgentCredentialRecord): Promise<void> {
    await mkdir(getCredentialsDir(this.baseDir), { recursive: true })
    await writeFile(
      getCredentialFilePath(record.credentialId, this.baseDir),
      JSON.stringify(record, null, 2),
      'utf8',
    )
  }

  async list(): Promise<AgentCredentialRecord[]> {
    try {
      const entries = await readdir(getCredentialsDir(this.baseDir), {
        withFileTypes: true,
      })
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<AgentCredentialRecord>(
              join(getCredentialsDir(this.baseDir), entry.name),
            ),
          ),
      )

      return records.filter(
        (record): record is AgentCredentialRecord => Boolean(record),
      )
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

  async listByAgent(agentId: string): Promise<AgentCredentialRecord[]> {
    return (await this.list()).filter((record) => record.agentId === agentId)
  }

  async remove(credentialId: string): Promise<void> {
    await rm(getCredentialFilePath(credentialId, this.baseDir), { force: true })
  }
}
