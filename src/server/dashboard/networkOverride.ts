/**
 * Dashboard-controlled Solana network selection.
 *
 * The active cluster (mainnet/devnet) is chosen on the Settings page, not via env — it is
 * persisted to `<baseDir>/network-override.json` and applied to the process environment so that
 * settlement (the OWS broadcast RPC, read live from process.env per call) and freshly-built
 * portfolio readers use it. The Helius API key stays in env; the RPC URL is derived from it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type NetworkChoice = 'mainnet' | 'devnet'

function overridePath(baseDir: string): string {
  return join(baseDir, 'network-override.json')
}

export function loadNetworkOverride(baseDir: string): NetworkChoice | undefined {
  try {
    const path = overridePath(baseDir)
    if (!existsSync(path)) return undefined
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { network?: unknown }
    return parsed.network === 'mainnet' || parsed.network === 'devnet' ? parsed.network : undefined
  } catch {
    return undefined
  }
}

/** Current effective network from the environment (defaults to mainnet). */
export function currentNetwork(env: Record<string, string | undefined> = process.env): NetworkChoice {
  const value = env.PUSD_SOLANA_NETWORK?.trim()
  return value === 'devnet' || value === 'solana-devnet' ? 'devnet' : 'mainnet'
}

/** Build a Solana RPC URL for the cluster, preferring the Helius key when present. */
export function buildSolanaRpcUrl(
  network: NetworkChoice,
  env: Record<string, string | undefined> = process.env,
): string {
  const key = env.HELIUS_API_KEY?.trim()
  if (key) {
    return network === 'mainnet'
      ? `https://mainnet.helius-rpc.com/?api-key=${key}`
      : `https://devnet.helius-rpc.com/?api-key=${key}`
  }
  return network === 'mainnet'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com'
}

/** Point an env map at the chosen cluster (network + derived RPC). Mutates `env` in place. */
export function applyNetworkToEnv(
  network: NetworkChoice,
  env: Record<string, string | undefined> = process.env,
): void {
  env.PUSD_SOLANA_NETWORK = network
  env.PUSD_SOLANA_RPC_URL = buildSolanaRpcUrl(network, env)
}

/** Persist the choice and apply it to process.env (settlement picks it up immediately). */
export function setNetworkOverride(baseDir: string, network: NetworkChoice): void {
  writeFileSync(overridePath(baseDir), `${JSON.stringify({ network }, null, 2)}\n`)
  applyNetworkToEnv(network, process.env)
}

/** Just the host (for display), e.g. "mainnet.helius-rpc.com". */
export function rpcHost(env: Record<string, string | undefined> = process.env): string {
  try {
    return new URL(env.PUSD_SOLANA_RPC_URL ?? buildSolanaRpcUrl(currentNetwork(env), env)).host
  } catch {
    return 'unknown'
  }
}
