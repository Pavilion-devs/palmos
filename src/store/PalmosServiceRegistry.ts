import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { SolanaCluster } from '../integrations/pusd/constants.js'

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export type RegisteredPalmosServiceMethod = 'GET' | 'POST'
export type RegisteredPalmosServiceRequestMode = 'query' | 'json'

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
}

export interface PalmosServiceRegistry {
  get(serviceId: string): Promise<RegisteredPalmosServiceRecord | undefined>
  put(record: RegisteredPalmosServiceRecord): Promise<void>
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
    await writeFile(
      getServiceFilePath(record.serviceId, this.baseDir),
      JSON.stringify(record, null, 2),
      'utf8',
    )
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
