import { mkdir, readdir, rm, rmdir } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { readJsonFile, writeJsonFile } from '../../runtime/runtime/jsonFile.js'

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
  putIfStatus(
    record: AgentCredentialRecord,
    expectedStatus: AgentCredentialRecord['status'],
  ): Promise<boolean>
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

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquireCredentialFileLock(lockDir: string): Promise<void> {
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

export class InMemoryAgentCredentialRegistry implements AgentCredentialRegistry {
  private readonly records = new Map<string, AgentCredentialRecord>()

  constructor(seedRecords: AgentCredentialRecord[] = []) {
    for (const record of seedRecords) {
      this.records.set(record.credentialId, record)
    }
  }

  async get(credentialId: string): Promise<AgentCredentialRecord | undefined> {
    return this.records.get(credentialId)
  }

  async put(record: AgentCredentialRecord): Promise<void> {
    this.records.set(record.credentialId, record)
  }

  async putIfStatus(
    record: AgentCredentialRecord,
    expectedStatus: AgentCredentialRecord['status'],
  ): Promise<boolean> {
    const current = this.records.get(record.credentialId)
    if (current?.status !== expectedStatus) {
      return false
    }
    this.records.set(record.credentialId, record)
    return true
  }

  async list(): Promise<AgentCredentialRecord[]> {
    return [...this.records.values()]
  }

  async listByAgent(agentId: string): Promise<AgentCredentialRecord[]> {
    return (await this.list()).filter((record) => record.agentId === agentId)
  }

  async remove(credentialId: string): Promise<void> {
    this.records.delete(credentialId)
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
    await writeJsonFile(getCredentialFilePath(record.credentialId, this.baseDir), record)
  }

  async putIfStatus(
    record: AgentCredentialRecord,
    expectedStatus: AgentCredentialRecord['status'],
  ): Promise<boolean> {
    await mkdir(getCredentialsDir(this.baseDir), { recursive: true })
    const lockDir = `${getCredentialFilePath(record.credentialId, this.baseDir)}.lock`
    await acquireCredentialFileLock(lockDir)
    try {
      const current = await this.get(record.credentialId)
      if (current?.status !== expectedStatus) {
        return false
      }
      await writeJsonFile(getCredentialFilePath(record.credentialId, this.baseDir), record)
      return true
    } finally {
      await rmdir(lockDir).catch(() => undefined)
    }
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
