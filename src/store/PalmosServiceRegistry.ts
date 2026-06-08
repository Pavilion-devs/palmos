import { mkdir, readdir, rm, rmdir } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { SolanaCluster } from '../integrations/pusd/constants.js'
import { readJsonFile, writeJsonFile } from '../../runtime/runtime/jsonFile.js'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type RegisteredPalmosServiceMethod = 'GET' | 'POST'
export type RegisteredPalmosServiceRequestMode = 'query' | 'json'
export type RegisteredPalmosServiceVerificationStatus =
  | 'verified'
  | 'failed'
  | 'unchecked'

export type RegisteredPalmosServiceRecord = {
  serviceId: string
  createdAt: string
  updatedAt: string
  label: string
  vendorId: string
  destinationAddress: string
  endpointUrl: string
  method: RegisteredPalmosServiceMethod
  requestMode: RegisteredPalmosServiceRequestMode
  expectedAmount: string
  chainId: SolanaCluster
  status: 'active' | 'disabled'
  verificationStatus?: RegisteredPalmosServiceVerificationStatus
  verifiedAt?: string
  lastVerificationError?: string
}

export interface PalmosServiceRegistry {
  get(serviceId: string): Promise<RegisteredPalmosServiceRecord | undefined>
  put(record: RegisteredPalmosServiceRecord): Promise<void>
  putIfUpdatedAt(
    record: RegisteredPalmosServiceRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean>
  list(): Promise<RegisteredPalmosServiceRecord[]>
  remove(serviceId: string): Promise<void>
}

function resolveBaseDir(baseDir?: string): string {
  return baseDir ? resolve(baseDir) : PACKAGE_ROOT
}

function getServicesDir(baseDir?: string): string {
  return join(resolveBaseDir(baseDir), 'services')
}

function getServiceFilePath(serviceId: string, baseDir?: string): string {
  return join(getServicesDir(baseDir), `${serviceId}.json`)
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function acquireServiceFileLock(lockDir: string): Promise<void> {
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

export class FilePalmosServiceRegistry implements PalmosServiceRegistry {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = resolveBaseDir(baseDir)
  }

  async get(serviceId: string): Promise<RegisteredPalmosServiceRecord | undefined> {
    return readJsonFile<RegisteredPalmosServiceRecord>(
      getServiceFilePath(serviceId, this.baseDir),
    )
  }

  async put(record: RegisteredPalmosServiceRecord): Promise<void> {
    await mkdir(getServicesDir(this.baseDir), { recursive: true })
    await writeJsonFile(getServiceFilePath(record.serviceId, this.baseDir), record)
  }

  async putIfUpdatedAt(
    record: RegisteredPalmosServiceRecord,
    expectedUpdatedAt: string,
  ): Promise<boolean> {
    await mkdir(getServicesDir(this.baseDir), { recursive: true })
    const lockDir = `${getServiceFilePath(record.serviceId, this.baseDir)}.lock`
    await acquireServiceFileLock(lockDir)
    try {
      const current = await this.get(record.serviceId)
      if (current?.updatedAt !== expectedUpdatedAt) {
        return false
      }
      await writeJsonFile(getServiceFilePath(record.serviceId, this.baseDir), record)
      return true
    } finally {
      await rmdir(lockDir).catch(() => undefined)
    }
  }

  async list(): Promise<RegisteredPalmosServiceRecord[]> {
    try {
      const entries = await readdir(getServicesDir(this.baseDir), {
        withFileTypes: true,
      })
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) =>
            readJsonFile<RegisteredPalmosServiceRecord>(
              join(getServicesDir(this.baseDir), entry.name),
            ),
          ),
      )

      return records.filter(
        (record): record is RegisteredPalmosServiceRecord => Boolean(record),
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

  async remove(serviceId: string): Promise<void> {
    await rm(getServiceFilePath(serviceId, this.baseDir), { force: true })
  }
}
