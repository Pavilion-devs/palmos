import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line
    const separatorIndex = withoutExport.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = withoutExport.slice(0, separatorIndex).trim()
    const value = withoutExport
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
    values[key] = value
  }

  return values
}

export function loadProcessEnv(input: {
  cwd?: string
  env?: Record<string, string | undefined>
  fileName?: string
} = {}): Record<string, string | undefined> {
  const processEnv = input.env ?? process.env
  const cwd = input.cwd ?? process.cwd()
  const envPath = join(cwd, input.fileName ?? '.env')

  if (!existsSync(envPath)) {
    return processEnv
  }

  return {
    ...parseEnvFile(readFileSync(envPath, 'utf8')),
    ...processEnv,
  }
}
