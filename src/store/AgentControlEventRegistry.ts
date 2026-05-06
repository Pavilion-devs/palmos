import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type AgentControlEventRecord = {
  controlEventId: string
  at: string
  agentId: string
  type: 'dead_man_switch.triggered'
  status: 'applied' | 'noop'
  summary: string
  refs?: {
    walletId?: string
    haltedRunIds?: string[]
  }
  metadata?: Record<string, unknown>
}

export interface AgentControlEventRegistry {
  get(controlEventId: string): Promise<AgentControlEventRecord | undefined>
  put(record: AgentControlEventRecord): Promise<void>
  list(): Promise<AgentControlEventRecord[]>
  remove(controlEventId: string): Promise<void>
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getControlEventsDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'control-events')
}

function getControlEventFilePath(
  controlEventId: string,
  baseDir?: string,
): string {
  return join(getControlEventsDir(baseDir), `${controlEventId}.json`)
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

export class InMemoryAgentControlEventRegistry
  implements AgentControlEventRegistry
{
  private readonly records = new Map<string, AgentControlEventRecord>()

  constructor(seedRecords: AgentControlEventRecord[] = []) {
    for (const record of seedRecords) {
      this.records.set(record.controlEventId, record)
    }
  }

  async get(
    controlEventId: string,
  ): Promise<AgentControlEventRecord | undefined> {
    return this.records.get(controlEventId)
  }

  async put(record: AgentControlEventRecord): Promise<void> {
    this.records.set(record.controlEventId, record)
  }

  async list(): Promise<AgentControlEventRecord[]> {
    return [...this.records.values()]
  }

  async remove(controlEventId: string): Promise<void> {
    this.records.delete(controlEventId)
  }
}

export class FileAgentControlEventRegistry
  implements AgentControlEventRegistry
{
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async get(
    controlEventId: string,
  ): Promise<AgentControlEventRecord | undefined> {
    return readJsonFile<AgentControlEventRecord>(
      getControlEventFilePath(controlEventId, this.baseDir),
    )
  }

  async put(record: AgentControlEventRecord): Promise<void> {
    await mkdir(getControlEventsDir(this.baseDir), { recursive: true })
    await writeFile(
      getControlEventFilePath(record.controlEventId, this.baseDir),
      JSON.stringify(record, null, 2),
      'utf8',
    )
  }

  async list(): Promise<AgentControlEventRecord[]> {
    try {
      const entries = await readdir(getControlEventsDir(this.baseDir), {
        withFileTypes: true,
      })
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<AgentControlEventRecord>(
              join(getControlEventsDir(this.baseDir), entry.name),
            ),
          ),
      )

      return records.filter(
        (record): record is AgentControlEventRecord => Boolean(record),
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

  async remove(controlEventId: string): Promise<void> {
    await rm(getControlEventFilePath(controlEventId, this.baseDir), {
      force: true,
    })
  }
}

