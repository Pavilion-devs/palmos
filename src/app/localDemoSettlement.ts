export type LocalDemoSettlementPosture = {
  allowed: boolean
  productionLike: boolean
  overrideEnabled: boolean
  reason: string
}

export function isProductionLikeEnvironment(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NODE_ENV?.trim() === 'production' || Boolean(env.RENDER?.trim())
}

export function isLocalDemoProductionOverrideEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value =
    env.PALMOS_ALLOW_LOCAL_DEMO_SETTLEMENT_IN_PRODUCTION?.trim().toLowerCase()
  return value === '1' || value === 'true'
}

export function readLocalDemoSettlementPosture(
  env: Record<string, string | undefined> = process.env,
): LocalDemoSettlementPosture {
  const productionLike = isProductionLikeEnvironment(env)
  const overrideEnabled = isLocalDemoProductionOverrideEnabled(env)
  const allowed = !productionLike || overrideEnabled

  return {
    allowed,
    productionLike,
    overrideEnabled,
    reason: allowed
      ? productionLike
        ? 'Local-demo settlement is explicitly override-enabled in a production-like environment.'
        : 'Local-demo settlement is allowed in this local/development environment.'
      : 'Local-demo settlement is blocked in production-like environments. Use real-solana or ows, or set PALMOS_ALLOW_LOCAL_DEMO_SETTLEMENT_IN_PRODUCTION=1 only for a controlled demo.',
  }
}
