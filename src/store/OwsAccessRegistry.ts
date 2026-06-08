import { mkdir, readdir, rm } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { readJsonFile, writeJsonFile } from '../../runtime/runtime/jsonFile.js'

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
    await writeJsonFile(getRecordPath(record.agentId, this.baseDir), record)
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
