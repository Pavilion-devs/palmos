import { loadProcessEnv } from '../../env/loadProcessEnv.js'
import type { Env } from './shared.js'

export function readProcessEnv(): Env {
  return loadProcessEnv()
}

export function resolveDashboardBaseDir(env: Env): string {
  const configuredBaseDir = env.AGENT_SPEND_OS_BASE_DIR?.trim()
  if (configuredBaseDir) {
    return configuredBaseDir
  }

  if (env.RENDER?.trim()) {
    return '/opt/render/project/src/storage/palmos-live'
  }

  return '/tmp/palmos-live'
}

export function resolveDashboardPort(env: Env): number {
  const configuredPort =
    env.PORT?.trim() || env.DASHBOARD_API_PORT?.trim() || '4030'
  const parsed = Number(configuredPort)
  return Number.isFinite(parsed) ? parsed : 4030
}

export function isPublicAccessMode(env: Env): boolean {
  const disabled = env.PALMOS_DISABLE_DASHBOARD_AUTH?.trim()?.toLowerCase()
  if (disabled === '1' || disabled === 'true') {
    return false
  }

  const configured = env.PALMOS_PUBLIC_ACCESS_MODE?.trim()?.toLowerCase()
  if (configured === '1' || configured === 'true') {
    return true
  }

  return env.NODE_ENV?.trim() === 'production' || Boolean(env.RENDER?.trim())
}

export function isShowcaseRunEnabled(env: Env): boolean {
  return (
    env.PALMOS_ENABLE_SHOWCASE_RUN?.trim() === '1' ||
    env.PALMOS_ENABLE_SHOWCASE_RUN?.trim()?.toLowerCase() === 'true'
  )
}

export function shouldUseCrossSiteJudgeCookie(env: Env): boolean {
  return (
    env.PALMOS_CROSS_SITE_COOKIES?.trim() === '1' ||
    env.PALMOS_CROSS_SITE_COOKIES?.trim()?.toLowerCase() === 'true' ||
    Boolean(env.RENDER?.trim())
  )
}

