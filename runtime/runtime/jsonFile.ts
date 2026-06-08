import {
  closeSync,
  copyFileSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { copyFile, open, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname } from 'path'

const BACKUP_SUFFIX = '.bak'

function backupPath(filePath: string): string {
  return `${filePath}${BACKUP_SUFFIX}`
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const contents = await readFile(filePath, 'utf8')
    return JSON.parse(contents) as T
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined
    }

    if (error instanceof SyntaxError) {
      try {
        const backupContents = await readFile(backupPath(filePath), 'utf8')
        return JSON.parse(backupContents) as T
      } catch {
        // Preserve the primary parse failure if no valid backup exists.
      }
    }

    throw error
  }
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(filePath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(dirname(filePath), 'r')
    await handle.sync()
  } catch {
    // Directory fsync is not available on every filesystem used in dev/CI.
  } finally {
    await handle?.close()
  }
}

export async function atomicWriteTextFile(
  filePath: string,
  contents: string,
): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`

  try {
    await writeFile(temporaryPath, contents, 'utf8')
    await syncFile(temporaryPath)
    await copyFile(filePath, backupPath(filePath)).catch((error: unknown) => {
      if (!isMissingFileError(error)) {
        throw error
      }
    })
    await rename(temporaryPath, filePath)
    await syncDirectory(filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function atomicWriteBufferFile(
  filePath: string,
  contents: Uint8Array,
): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`

  try {
    await writeFile(temporaryPath, contents)
    await syncFile(temporaryPath)
    await copyFile(filePath, backupPath(filePath)).catch((error: unknown) => {
      if (!isMissingFileError(error)) {
        throw error
      }
    })
    await rename(temporaryPath, filePath)
    await syncDirectory(filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function writeJsonFile(
  filePath: string,
  value: unknown,
): Promise<void> {
  await atomicWriteTextFile(filePath, JSON.stringify(value, null, 2))
}

export function readJsonFileSync<T>(filePath: string): T | undefined {
  try {
    const contents = readFileSync(filePath, 'utf8')
    return JSON.parse(contents) as T
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined
    }

    if (error instanceof SyntaxError) {
      try {
        const backupContents = readFileSync(backupPath(filePath), 'utf8')
        return JSON.parse(backupContents) as T
      } catch {
        // Preserve the primary parse failure if no valid backup exists.
      }
    }

    throw error
  }
}

function syncFileSync(filePath: string): void {
  const handle = openSync(filePath, 'r')
  try {
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
}

function syncDirectorySync(filePath: string): void {
  let handle: number | undefined
  try {
    handle = openSync(dirname(filePath), 'r')
    fsyncSync(handle)
  } catch {
    // Directory fsync is not available on every filesystem used in dev/CI.
  } finally {
    if (handle !== undefined) {
      closeSync(handle)
    }
  }
}

export function atomicWriteTextFileSync(
  filePath: string,
  contents: string,
): void {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`

  try {
    writeFileSync(temporaryPath, contents, 'utf8')
    syncFileSync(temporaryPath)
    try {
      copyFileSync(filePath, backupPath(filePath))
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error
      }
    }
    renameSync(temporaryPath, filePath)
    syncDirectorySync(filePath)
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // Best-effort cleanup.
    }
    throw error
  }
}

export function writeJsonFileSync(filePath: string, value: unknown): void {
  atomicWriteTextFileSync(filePath, JSON.stringify(value, null, 2))
}
