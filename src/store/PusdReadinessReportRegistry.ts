import { mkdir, readdir, rm } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { PusdPaymentReadinessReport } from '../integrations/pusd/readiness.js'
import { readJsonFile, writeJsonFile } from '../../runtime/runtime/jsonFile.js'

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
  prune(input: PusdReadinessReportPruneInput): Promise<PusdReadinessReportPruneResult>
}

export type PusdReadinessReportPruneInput = {
  maxRecords?: number
  maxAgeMs?: number
  now?: number
}

export type PusdReadinessReportPruneResult = {
  kept: number
  removed: number
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

function shouldPruneRecord(input: {
  record: PusdReadinessReportRecord
  index: number
  maxRecords?: number
  maxAgeMs?: number
  now: number
}): boolean {
  if (input.maxRecords != null && input.index >= input.maxRecords) {
    return true
  }

  if (input.maxAgeMs == null) {
    return false
  }

  const updatedAt = Date.parse(input.record.updatedAt)
  return Number.isFinite(updatedAt) && updatedAt < input.now - input.maxAgeMs
}

export class FilePusdReadinessReportRegistry implements PusdReadinessReportRegistry {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async put(record: PusdReadinessReportRecord): Promise<void> {
    await mkdir(getReadinessDir(this.baseDir), { recursive: true })
    await writeJsonFile(getReadinessFilePath(record.reportId, this.baseDir), record)
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

  async prune(
    input: PusdReadinessReportPruneInput,
  ): Promise<PusdReadinessReportPruneResult> {
    const sorted = await this.list()
    const now = input.now ?? Date.now()
    let removed = 0

    for (const [index, record] of sorted.entries()) {
      if (
        shouldPruneRecord({
          record,
          index,
          maxRecords: input.maxRecords,
          maxAgeMs: input.maxAgeMs,
          now,
        })
      ) {
        await rm(getReadinessFilePath(record.reportId, this.baseDir), {
          force: true,
        })
        await rm(`${getReadinessFilePath(record.reportId, this.baseDir)}.bak`, {
          force: true,
        })
        removed += 1
      }
    }

    return {
      kept: sorted.length - removed,
      removed,
    }
  }
}
