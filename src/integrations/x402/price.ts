function normalizeUsdAmount(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    return fallback
  }

  const normalized = trimmed.replace(/^\$/, '').trim()
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    return fallback
  }

  return normalized
}

export function readLocalDemoSpotPriceAmountFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  return normalizeUsdAmount(
    env.X402_DEMO_SPOT_PRICE ?? env.X402_DEMO_PRICE,
    '0.01',
  )
}

export function readLocalDemoOpsBriefAmountFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  return normalizeUsdAmount(env.X402_DEMO_OPS_BRIEF_PRICE, '0.25')
}

export function readLocalDemoExpectedAmountFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  return readLocalDemoSpotPriceAmountFromEnv(env)
}
