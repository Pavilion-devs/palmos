import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type XMTPAlertType =
  | 'approval.requested'
  | 'approval.resolved'
  | 'dead_man_switch.triggered'

export type XMTPAlertStatus = 'sent' | 'skipped' | 'failed'

export type XMTPAlertRecord = {
  alertId: string
  createdAt: string
  updatedAt: string
  type: XMTPAlertType
  status: XMTPAlertStatus
  agentId?: string
  runId?: string
  executionId?: string
  controlEventId?: string
  recipientInboxId?: string
  recipientAddress?: string
  conversationId?: string
  messageId?: string
  messagePreview: string
  reason?: string
}

export interface XMTPAlertRegistry {
  get(alertId: string): Promise<XMTPAlertRecord | undefined>
  put(record: XMTPAlertRecord): Promise<void>
  list(): Promise<XMTPAlertRecord[]>
  remove(alertId: string): Promise<void>
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getAlertsDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'xmtp-alerts')
}

function getAlertFilePath(alertId: string, baseDir?: string): string {
  return join(getAlertsDir(baseDir), `${alertId}.json`)
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

export class InMemoryXMTPAlertRegistry implements XMTPAlertRegistry {
  private readonly records = new Map<string, XMTPAlertRecord>()

  constructor(seedRecords: XMTPAlertRecord[] = []) {
    for (const record of seedRecords) {
      this.records.set(record.alertId, record)
    }
  }

  async get(alertId: string): Promise<XMTPAlertRecord | undefined> {
    return this.records.get(alertId)
  }

  async put(record: XMTPAlertRecord): Promise<void> {
    this.records.set(record.alertId, record)
  }

  async list(): Promise<XMTPAlertRecord[]> {
    return [...this.records.values()]
  }

  async remove(alertId: string): Promise<void> {
    this.records.delete(alertId)
  }
}

export class FileXMTPAlertRegistry implements XMTPAlertRegistry {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async get(alertId: string): Promise<XMTPAlertRecord | undefined> {
    return readJsonFile<XMTPAlertRecord>(getAlertFilePath(alertId, this.baseDir))
  }

  async put(record: XMTPAlertRecord): Promise<void> {
    await mkdir(getAlertsDir(this.baseDir), { recursive: true })
    await writeFile(
      getAlertFilePath(record.alertId, this.baseDir),
      JSON.stringify(record, null, 2),
      'utf8',
    )
  }

  async list(): Promise<XMTPAlertRecord[]> {
    try {
      const entries = await readdir(getAlertsDir(this.baseDir), {
        withFileTypes: true,
      })
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<XMTPAlertRecord>(
              join(getAlertsDir(this.baseDir), entry.name),
            ),
          ),
      )

      return records.filter((record): record is XMTPAlertRecord => Boolean(record))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return []
      }

      throw error
    }
  }

  async remove(alertId: string): Promise<void> {
    await rm(getAlertFilePath(alertId, this.baseDir), { force: true })
  }
}
