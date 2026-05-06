import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  buildShowcaseSnapshot,
  renderDashboardHtml,
  writeShowcaseSnapshot,
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

const env = readProcessEnv()
const baseDir =
  env.AGENT_SPEND_OS_BASE_DIR?.trim() ||
  (() => {
    throw new Error('AGENT_SPEND_OS_BASE_DIR is required for dashboard export.')
  })()

const snapshot = await buildShowcaseSnapshot({
  baseDir,
  zerionClient: ZerionClient.fromEnv(env),
})
const html = renderDashboardHtml(snapshot)
const outputDir = join(baseDir, 'dashboard')
await mkdir(outputDir, { recursive: true })
const htmlPath = join(outputDir, 'index.html')
await writeFile(htmlPath, html, 'utf8')
const jsonPath = await writeShowcaseSnapshot({
  baseDir,
  snapshot,
})

console.log(
  JSON.stringify(
    {
      ok: true,
      baseDir,
      htmlPath,
      jsonPath,
      zerionEnabled: Boolean(ZerionClient.fromEnv(env)),
    },
    null,
    2,
  ),
)
