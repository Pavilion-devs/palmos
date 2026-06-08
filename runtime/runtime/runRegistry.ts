import type { RunState } from '../contracts/runtime.js'
import { mkdir, readdir, rm } from 'fs/promises'
import {
  getRunDir,
  getRunManifestPath,
  getRunsDir,
  resolveStorageBaseDir,
} from './fileLayout.js'
import { readJsonFile, writeJsonFile } from './jsonFile.js'

export interface RunRegistry {
  get(runId: string): Promise<RunState | undefined>
  put(run: RunState): Promise<void>
  listBySession(sessionId: string): Promise<RunState[]>
  remove(runId: string): Promise<void>
}

export class InMemoryRunRegistry implements RunRegistry {
  private readonly runs = new Map<string, RunState>()

  async get(runId: string): Promise<RunState | undefined> {
    return this.runs.get(runId)
  }

  async put(run: RunState): Promise<void> {
    this.runs.set(run.runId, run)
  }

  async listBySession(sessionId: string): Promise<RunState[]> {
    return [...this.runs.values()].filter((run) => run.sessionId === sessionId)
  }

  async remove(runId: string): Promise<void> {
    this.runs.delete(runId)
  }
}

export class FileRunRegistry implements RunRegistry {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveStorageBaseDir(baseDir)
  }

  async get(runId: string): Promise<RunState | undefined> {
    return readJsonFile<RunState>(getRunManifestPath(runId, this.baseDir))
  }

  async put(run: RunState): Promise<void> {
    const dir = getRunDir(run.runId, this.baseDir)
    await mkdir(dir, { recursive: true })
    await writeJsonFile(getRunManifestPath(run.runId, this.baseDir), run)
  }

  async listBySession(sessionId: string): Promise<RunState[]> {
    try {
      const entries = await readdir(getRunsDir(this.baseDir), {
        withFileTypes: true,
      })
      const runs = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => this.get(entry.name)),
      )
      return runs.filter((run): run is RunState => {
        if (!run) {
          return false
        }
        return run.sessionId === sessionId
      })
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

  async remove(runId: string): Promise<void> {
    await rm(getRunDir(runId, this.baseDir), {
      recursive: true,
      force: true,
    })
  }
}
