import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type OwsAccessRecord = {
  agentId: string
  createdAt: string
  updatedAt: string
  runtimeWalletId: string
  owsWalletId: string
  owsWalletName: string
  vaultPath: string
  apiKeyId?: string
  apiKeyName?: string
  apiKeyToken?: string
}

export interface OwsAccessRegistry {
  get(agentId: string): Promise<OwsAccessRecord | undefined>
  put(record: OwsAccessRecord): Promise<void>
  list(): Promise<OwsAccessRecord[]>
  remove(agentId: string): Promise<void>
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getRecordsDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'ows-access')
}

function getRecordPath(agentId: string, baseDir?: string): string {
  return join(getRecordsDir(baseDir), `${agentId}.json`)
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const contents = await readFile(path, 'utf8')
    return JSON.parse(contents) as T
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}

export class FileOwsAccessRegistry implements OwsAccessRegistry {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async get(agentId: string): Promise<OwsAccessRecord | undefined> {
    return readJsonFile<OwsAccessRecord>(getRecordPath(agentId, this.baseDir))
  }

  async put(record: OwsAccessRecord): Promise<void> {
    await mkdir(getRecordsDir(this.baseDir), { recursive: true })
    await writeFile(
      getRecordPath(record.agentId, this.baseDir),
      JSON.stringify(record, null, 2),
      'utf8',
    )
  }

  async list(): Promise<OwsAccessRecord[]> {
    try {
      const entries = await readdir(getRecordsDir(this.baseDir), {
        withFileTypes: true,
      })
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<OwsAccessRecord>(join(getRecordsDir(this.baseDir), entry.name)),
          ),
      )
      return records.filter((record): record is OwsAccessRecord => Boolean(record))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return []
      }

      throw error
    }
  }

  async remove(agentId: string): Promise<void> {
    await rm(getRecordPath(agentId, this.baseDir), { force: true })
  }
}
