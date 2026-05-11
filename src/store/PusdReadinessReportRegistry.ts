import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { PusdPaymentReadinessReport } from '../integrations/pusd/readiness.js'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type PusdReadinessReportRecord = {
  reportId: string
  createdAt: string
  updatedAt: string
  agentId?: string
  serviceId?: string
  walletName?: string
  ok: boolean
  report: PusdPaymentReadinessReport
}

export interface PusdReadinessReportRegistry {
  put(record: PusdReadinessReportRecord): Promise<void>
  list(): Promise<PusdReadinessReportRecord[]>
  latest(): Promise<PusdReadinessReportRecord | undefined>
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getReadinessDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'pusd-readiness')
}

function getReadinessFilePath(reportId: string, baseDir?: string): string {
  return join(getReadinessDir(baseDir), `${reportId}.json`)
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

export class FilePusdReadinessReportRegistry implements PusdReadinessReportRegistry {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async put(record: PusdReadinessReportRecord): Promise<void> {
    await mkdir(getReadinessDir(this.baseDir), { recursive: true })
    await writeFile(
      getReadinessFilePath(record.reportId, this.baseDir),
      JSON.stringify(record, null, 2),
      'utf8',
    )
  }

  async list(): Promise<PusdReadinessReportRecord[]> {
    try {
      const entries = await readdir(getReadinessDir(this.baseDir), {
        withFileTypes: true,
      })
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<PusdReadinessReportRecord>(
              join(getReadinessDir(this.baseDir), entry.name),
            ),
          ),
      )

      return records
        .filter((record): record is PusdReadinessReportRecord => Boolean(record))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
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

  async latest(): Promise<PusdReadinessReportRecord | undefined> {
    return (await this.list())[0]
  }
}
