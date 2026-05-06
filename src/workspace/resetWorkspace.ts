import { rm } from 'fs/promises'
import { join, relative, resolve } from 'path'
import { readOwsConfigFromEnv } from '../integrations/ows/client.js'

const WORKSPACE_DIRS = [
  'agents',
  'agent-credentials',
  'control-events',
  'dashboard',
  'ows-access',
  'paid-calls',
  'runs',
  'services',
  'sessions',
  'signer-profiles',
  'wallets',
  'xmtp-alerts',
] as const

function isWithinBaseDir(baseDir: string, targetPath: string): boolean {
  const relativePath = relative(baseDir, targetPath)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !relativePath.startsWith('../'))
  )
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)]
}

export async function resetAgentSpendWorkspace(input: {
  baseDir: string
  env?: Record<string, string | undefined>
}): Promise<void> {
  const baseDir = resolve(input.baseDir)
  const owsConfig = readOwsConfigFromEnv(baseDir, input.env)
  const xmtpDbPath = resolve(
    input.env?.XMTP_DB_PATH?.trim() || join(baseDir, 'xmtp-local.db3'),
  )
  const extraPaths = uniquePaths(
    [owsConfig.homeDir, owsConfig.vaultPath, xmtpDbPath]
      .map((value) => resolve(value))
      .filter((value) => isWithinBaseDir(baseDir, value)),
  )

  await Promise.all([
    ...WORKSPACE_DIRS.map((dirName) =>
      rm(join(baseDir, dirName), { recursive: true, force: true }),
    ),
    ...extraPaths.map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  ])
}
