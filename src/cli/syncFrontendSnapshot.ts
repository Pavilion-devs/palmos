import { mkdir, readdir, stat, writeFile } from 'fs/promises'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'
import {
  buildShowcaseSnapshot,
  type ShowcaseSnapshot,
  ZerionClient,
} from '../index.js'

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

async function detectLatestWorkspace(): Promise<string | undefined> {
  const tmpDir = '/tmp'
  const entries = await readdir(tmpDir, { withFileTypes: true }).catch(() => [])
  const scoreTable = {
    agents: 4,
    'paid-calls': 4,
    'xmtp-alerts': 2,
    'ows-access': 2,
    dashboard: 1,
  } as const
  const candidates = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          (entry.name.startsWith('agent-spend-os-') ||
            entry.name.startsWith('palmos-')),
      )
      .map(async (entry) => {
        const fullPath = join(tmpDir, entry.name)
        const scoredDirs = Object.keys(scoreTable)
        const score = (
          await Promise.all(
            scoredDirs.map(async (dirName) => {
              try {
                const info = await stat(join(fullPath, dirName))
                return info.isDirectory()
                  ? scoreTable[dirName as keyof typeof scoreTable]
                  : 0
              } catch {
                return 0
              }
            }),
          )
        ).reduce<number>((total, value) => total + value, 0)

        const modifiedAt = (await stat(fullPath)).mtimeMs
        return { fullPath, score, modifiedAt }
      }),
  )

  return candidates
    .filter((candidate) => candidate.score >= 8)
    .sort((left, right) => right.score - left.score || right.modifiedAt - left.modifiedAt)[0]
    ?.fullPath
}

function sanitizeSnapshot(snapshot: ShowcaseSnapshot): ShowcaseSnapshot {
  const stripAgentSecrets = (agent: ShowcaseSnapshot['agents'][number]['agent']) => {
    const { owsVaultPath: _owsVaultPath, ...safeAgent } = agent
    return safeAgent
  }

  return {
    ...snapshot,
    baseDir: 'synced-for-frontend',
    agents: snapshot.agents.map((agentSnapshot) => ({
      ...agentSnapshot,
      agent: stripAgentSecrets(agentSnapshot.agent),
      owsAccess: agentSnapshot.owsAccess
        ? {
            agentId: agentSnapshot.owsAccess.agentId,
            createdAt: agentSnapshot.owsAccess.createdAt,
            updatedAt: agentSnapshot.owsAccess.updatedAt,
            runtimeWalletId: agentSnapshot.owsAccess.runtimeWalletId,
            owsWalletId: agentSnapshot.owsAccess.owsWalletId,
            owsWalletName: agentSnapshot.owsAccess.owsWalletName,
            vaultPath: agentSnapshot.owsAccess.vaultPath,
            apiKeyId: agentSnapshot.owsAccess.apiKeyId,
            apiKeyName: agentSnapshot.owsAccess.apiKeyName,
          }
        : undefined,
      audit: {
        ...agentSnapshot.audit,
        agent: stripAgentSecrets(agentSnapshot.audit.agent),
      },
    })),
  }
}

const env = readProcessEnv()
const baseDir =
  env.AGENT_SPEND_OS_BASE_DIR?.trim() || (await detectLatestWorkspace())

if (!baseDir) {
  throw new Error(
    'Unable to resolve a workspace. Set AGENT_SPEND_OS_BASE_DIR to a valid PalmOS base directory.',
  )
}

const frontendPublicDir =
  env.AGENT_SPEND_OS_FRONTEND_PUBLIC_DIR?.trim() ||
  resolve(fileURLToPath(new URL('../../frontend/public', import.meta.url)))
const outputPath = join(frontendPublicDir, 'showcase-snapshot.json')

const snapshot = sanitizeSnapshot(
  await buildShowcaseSnapshot({
    baseDir,
    zerionClient: ZerionClient.fromEnv(env),
  }),
)

await mkdir(frontendPublicDir, { recursive: true })
await writeFile(outputPath, JSON.stringify(snapshot, null, 2), 'utf8')

console.log(
  JSON.stringify(
    {
      ok: true,
      sourceBaseDir: baseDir,
      outputPath,
      agentCount: snapshot.summary.agentCount,
      executedCalls: snapshot.summary.executedCalls,
      pendingCalls: snapshot.summary.approvalPendingCalls,
      blockedOrFailedCalls: snapshot.summary.blockedOrFailedCalls,
      xmtpAlertsSent: snapshot.summary.xmtpAlertsSent,
      owsBackedAgents: snapshot.summary.owsBackedAgents,
    },
    null,
    2,
  ),
)
