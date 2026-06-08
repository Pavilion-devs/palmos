import { createReadStream, createWriteStream } from 'fs'
import { mkdir, readFile, readdir, stat } from 'fs/promises'
import { createGzip, gunzipSync } from 'zlib'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import type { DashboardStorageContext } from './storageStatus.js'
import { atomicWriteBufferFile } from '../../../runtime/runtime/jsonFile.js'

const BLOCK_SIZE = 512

type ArchiveEntry = {
  absolutePath: string
  archivePath: string
  size: number
  mtime: Date
}

export type DashboardStorageBackupInspectionEntry = {
  archivePath: string
  targetPath?: string
  sizeBytes: number
}

type ParsedTarEntry = DashboardStorageBackupInspectionEntry & {
  dataOffset: number
  dataEnd: number
  typeFlag: string
}

function timestampForFileName(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

function normalizeArchivePath(path: string): string {
  return path.split(sep).join('/')
}

function shouldSkipArchivePath(path: string): boolean {
  return (
    path.endsWith('.tmp') ||
    path === 'backups' ||
    path.startsWith('backups/') ||
    path.includes('/backups/')
  )
}

function writeString(
  buffer: Buffer,
  value: string,
  offset: number,
  length: number,
): void {
  buffer.write(value.slice(0, length), offset, length, 'utf8')
}

function writeOctal(
  buffer: Buffer,
  value: number,
  offset: number,
  length: number,
): void {
  const octal = Math.trunc(value).toString(8).padStart(length - 1, '0')
  buffer.write(`${octal}\0`, offset, length, 'ascii')
}

function splitTarPath(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) {
    return { name: path, prefix: '' }
  }

  const parts = path.split('/')
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const name = parts.slice(index).join('/')
    const prefix = parts.slice(0, index).join('/')
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) {
      return { name, prefix }
    }
  }

  throw new Error(`Archive path is too long for tar format: ${path}`)
}

function createTarHeader(entry: ArchiveEntry): Buffer {
  const header = Buffer.alloc(BLOCK_SIZE)
  const { name, prefix } = splitTarPath(entry.archivePath)

  writeString(header, name, 0, 100)
  writeOctal(header, 0o644, 100, 8)
  writeOctal(header, 0, 108, 8)
  writeOctal(header, 0, 116, 8)
  writeOctal(header, entry.size, 124, 12)
  writeOctal(header, Math.floor(entry.mtime.getTime() / 1000), 136, 12)
  header.fill(' ', 148, 156)
  writeString(header, '0', 156, 1)
  writeString(header, 'ustar', 257, 6)
  writeString(header, '00', 263, 2)
  writeString(header, 'palmos', 265, 32)
  writeString(header, 'palmos', 297, 32)
  writeString(header, prefix, 345, 155)

  let checksum = 0
  for (const byte of header) {
    checksum += byte
  }
  const checksumText = checksum.toString(8).padStart(6, '0')
  header.write(`${checksumText}\0 `, 148, 8, 'ascii')

  return header
}

function readNullTerminatedString(
  buffer: Buffer,
  offset: number,
  length: number,
): string {
  const raw = buffer.subarray(offset, offset + length)
  const end = raw.indexOf(0)
  return raw.subarray(0, end >= 0 ? end : undefined).toString('utf8')
}

function readOctal(buffer: Buffer, offset: number, length: number): number {
  const value = readNullTerminatedString(buffer, offset, length).trim()
  if (!value) {
    return 0
  }

  const parsed = Number.parseInt(value, 8)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid tar octal field: ${value}`)
  }
  return parsed
}

function readTarPath(header: Buffer): string {
  const name = readNullTerminatedString(header, 0, 100)
  const prefix = readNullTerminatedString(header, 345, 155)
  return prefix ? `${prefix}/${name}` : name
}

function isZeroBlock(buffer: Buffer): boolean {
  return buffer.every((byte) => byte === 0)
}

function isUnsafeArchivePath(path: string): boolean {
  return (
    !path ||
    path.includes('\\') ||
    isAbsolute(path) ||
    path.split('/').some((segment) => segment === '..')
  )
}

function isWithinBaseDir(baseDir: string, targetPath: string): boolean {
  const relativeTarget = relative(baseDir, targetPath)
  return (
    relativeTarget === '' ||
    (!relativeTarget.startsWith('..') && !isAbsolute(relativeTarget))
  )
}

function parseTarArchive(input: {
  archivePath: string
  tar: Buffer
  targetBaseDir?: string
}): {
  archivePath: string
  targetBaseDir?: string
  entryCount: number
  totalBytes: number
  entries: ParsedTarEntry[]
  issues: string[]
} {
  const targetBaseDir = input.targetBaseDir
    ? resolve(input.targetBaseDir)
    : undefined
  const entries: ParsedTarEntry[] = []
  const issues: string[] = []
  let offset = 0

  while (offset < input.tar.length) {
    const header = input.tar.subarray(offset, offset + BLOCK_SIZE)
    if (header.length < BLOCK_SIZE) {
      issues.push('Archive has a truncated tar header.')
      break
    }

    if (isZeroBlock(header)) {
      break
    }

    const archivePath = readTarPath(header)
    const sizeBytes = readOctal(header, 124, 12)
    const typeFlag = readNullTerminatedString(header, 156, 1) || '0'
    if (typeFlag !== '0') {
      issues.push(`Unsupported tar entry type ${typeFlag} for ${archivePath}.`)
    }

    if (isUnsafeArchivePath(archivePath)) {
      issues.push(`Unsafe archive path: ${archivePath}`)
    }

    const targetPath = targetBaseDir
      ? resolve(targetBaseDir, archivePath)
      : undefined
    if (targetBaseDir && targetPath && !isWithinBaseDir(targetBaseDir, targetPath)) {
      issues.push(`Archive path escapes target base directory: ${archivePath}`)
    }

    const dataOffset = offset + BLOCK_SIZE
    const dataEnd = dataOffset + sizeBytes
    const nextOffset =
      dataEnd + ((BLOCK_SIZE - (sizeBytes % BLOCK_SIZE)) % BLOCK_SIZE)

    entries.push({
      archivePath,
      targetPath,
      sizeBytes,
      dataOffset,
      dataEnd,
      typeFlag,
    })

    if (nextOffset > input.tar.length) {
      issues.push(`Archive entry is truncated: ${archivePath}`)
      break
    }
    offset = nextOffset
  }

  const totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0)
  return {
    archivePath: input.archivePath,
    targetBaseDir,
    entryCount: entries.length,
    totalBytes,
    entries,
    issues,
  }
}

async function existingTargetIssue(entry: ParsedTarEntry): Promise<string | undefined> {
  if (!entry.targetPath) {
    return undefined
  }

  try {
    const metadata = await stat(entry.targetPath)
    if (!metadata.isFile()) {
      return `Restore target exists and is not a file: ${entry.archivePath}`
    }
    return `Restore target already exists: ${entry.archivePath}`
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

async function collectArchiveEntries(baseDir: string): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = []

  async function visit(dir: string): Promise<void> {
    let children
    try {
      children = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return
      }
      throw error
    }

    for (const child of children) {
      const absolutePath = join(dir, child.name)
      const archivePath = normalizeArchivePath(relative(baseDir, absolutePath))
      if (!archivePath || shouldSkipArchivePath(archivePath)) {
        continue
      }

      if (child.isDirectory()) {
        await visit(absolutePath)
        continue
      }

      if (!child.isFile()) {
        continue
      }

      const metadata = await stat(absolutePath)
      entries.push({
        absolutePath,
        archivePath,
        size: metadata.size,
        mtime: metadata.mtime,
      })
    }
  }

  await visit(baseDir)
  return entries.sort((left, right) =>
    left.archivePath.localeCompare(right.archivePath),
  )
}

async function* streamTar(entries: ArchiveEntry[]) {
  for (const entry of entries) {
    yield createTarHeader(entry)

    for await (const chunk of createReadStream(entry.absolutePath)) {
      yield chunk as Buffer
    }

    const padding = (BLOCK_SIZE - (entry.size % BLOCK_SIZE)) % BLOCK_SIZE
    if (padding > 0) {
      yield Buffer.alloc(padding)
    }
  }

  yield Buffer.alloc(BLOCK_SIZE)
  yield Buffer.alloc(BLOCK_SIZE)
}

export async function createDashboardStorageBackup(
  context: DashboardStorageContext,
  input: {
    outputDir?: string
    now?: Date
  } = {},
) {
  const outputDir = input.outputDir?.trim() || join(context.baseDir, 'backups')
  await mkdir(outputDir, { recursive: true })

  const entries = await collectArchiveEntries(context.baseDir)
  const archivePath = join(
    outputDir,
    `palmos-workspace-${timestampForFileName(input.now)}.tar.gz`,
  )

  await pipeline(
    Readable.from(streamTar(entries)),
    createGzip({ level: 9 }),
    createWriteStream(archivePath),
  )

  const archiveStats = await stat(archivePath)
  return {
    archivePath,
    entryCount: entries.length,
    sizeBytes: archiveStats.size,
  }
}

export async function inspectDashboardStorageBackup(input: {
  archivePath: string
  targetBaseDir?: string
}) {
  const compressed = await readFile(input.archivePath)
  const tar = gunzipSync(compressed)
  const parsed = parseTarArchive({
    archivePath: input.archivePath,
    tar,
    targetBaseDir: input.targetBaseDir,
  })
  const entries: DashboardStorageBackupInspectionEntry[] = parsed.entries.map(
    (entry) => ({
      archivePath: entry.archivePath,
      targetPath: entry.targetPath,
      sizeBytes: entry.sizeBytes,
    }),
  )

  return {
    ok: parsed.issues.length === 0,
    archivePath: parsed.archivePath,
    targetBaseDir: parsed.targetBaseDir,
    entryCount: parsed.entryCount,
    totalBytes: parsed.totalBytes,
    entries,
    issues: parsed.issues,
  }
}

export async function restoreDashboardStorageBackup(input: {
  archivePath: string
  targetBaseDir: string
  confirm: boolean
  overwriteExisting?: boolean
}) {
  const compressed = await readFile(input.archivePath)
  const tar = gunzipSync(compressed)
  const parsed = parseTarArchive({
    archivePath: input.archivePath,
    tar,
    targetBaseDir: input.targetBaseDir,
  })
  const issues = [...parsed.issues]

  if (!input.confirm) {
    issues.push('Restore requires confirm=true.')
  }

  for (const entry of parsed.entries) {
    if (entry.typeFlag !== '0' || !entry.targetPath) {
      continue
    }

    const issue = await existingTargetIssue(entry)
    if (issue && !input.overwriteExisting) {
      issues.push(issue)
    } else if (issue?.includes('not a file')) {
      issues.push(issue)
    }
  }

  const entries: DashboardStorageBackupInspectionEntry[] = parsed.entries.map(
    (entry) => ({
      archivePath: entry.archivePath,
      targetPath: entry.targetPath,
      sizeBytes: entry.sizeBytes,
    }),
  )

  if (issues.length > 0) {
    return {
      ok: false,
      archivePath: parsed.archivePath,
      targetBaseDir: parsed.targetBaseDir,
      entryCount: parsed.entryCount,
      totalBytes: parsed.totalBytes,
      restoredCount: 0,
      entries,
      issues,
    }
  }

  let restoredCount = 0
  for (const entry of parsed.entries) {
    if (!entry.targetPath) {
      continue
    }

    await mkdir(dirname(entry.targetPath), { recursive: true })
    await atomicWriteBufferFile(
      entry.targetPath,
      tar.subarray(entry.dataOffset, entry.dataEnd),
    )
    restoredCount += 1
  }

  return {
    ok: true,
    archivePath: parsed.archivePath,
    targetBaseDir: parsed.targetBaseDir,
    entryCount: parsed.entryCount,
    totalBytes: parsed.totalBytes,
    restoredCount,
    entries,
    issues: [],
  }
}
