/**
 * Persistence + wiring for the Mantle layer. The deploy/mint scripts write a single
 * `<baseDir>/mantle/deployment.json` artifact (contract addresses + the agent's minted identity),
 * which becomes the source of truth so nobody hand-copies addresses between deploy → mint → runtime.
 * env vars still override the artifact; MANTLE_RECORD_LIVE stays env-only so the artifact can never
 * by itself enable gas-spending live writes.
 */
import { mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { readJsonFile, writeJsonFile } from '../../../runtime/runtime/jsonFile.js'
import type { OwsClient } from '../ows/client.js'
import {
  MantleClient,
  readMantleConfigFromEnv,
  resolveMantleAccount,
  type MantleConfig,
} from './client.js'

export type MantleAgentIdentity = {
  agentId: string
  owner: string
  solanaPaymentAddress?: string
  card?: unknown
  cardUri?: string
  tokenUrl?: string
  mintTx?: string
  mintTxUrl?: string
}

export type MantleDeployment = {
  chainId: number
  explorer: string
  rpcUrl?: string
  identityRegistry?: string
  actionLog?: string
  deployer?: string
  deployTx?: { identityRegistry?: string; actionLog?: string }
  agent?: MantleAgentIdentity
  updatedAt?: string
}

function deploymentPath(baseDir: string): string {
  return join(baseDir, 'mantle', 'deployment.json')
}

export async function readMantleDeployment(
  baseDir: string,
): Promise<MantleDeployment | undefined> {
  return (await readJsonFile<MantleDeployment>(deploymentPath(baseDir))) ?? undefined
}

export async function writeMantleDeployment(
  baseDir: string,
  data: MantleDeployment,
): Promise<void> {
  const path = deploymentPath(baseDir)
  await mkdir(dirname(path), { recursive: true })
  await writeJsonFile(path, data)
}

export async function mergeMantleDeployment(
  baseDir: string,
  patch: Partial<MantleDeployment>,
  now: () => string = () => new Date().toISOString(),
): Promise<MantleDeployment> {
  const current = (await readMantleDeployment(baseDir)) ?? { chainId: 5003, explorer: '' }
  const next: MantleDeployment = { ...current, ...patch, updatedAt: now() }
  await writeMantleDeployment(baseDir, next)
  return next
}

/**
 * Resolve the effective Mantle config: env first, with the deployment artifact filling any gaps
 * (addresses + minted agentId). recordLive is taken ONLY from env.
 */
export async function loadMantleConfig(
  baseDir: string,
  env: Record<string, string | undefined>,
): Promise<MantleConfig> {
  const fromEnv = readMantleConfigFromEnv(env)
  const deployment = await readMantleDeployment(baseDir)
  if (!deployment) return fromEnv
  const asHex = (v?: string) => (v && v.startsWith('0x') ? (v as `0x${string}`) : undefined)
  let agentId = fromEnv.agentId
  if (agentId == null && deployment.agent?.agentId) {
    try {
      agentId = BigInt(deployment.agent.agentId)
    } catch {
      agentId = undefined
    }
  }
  return {
    ...fromEnv,
    rpcUrl: env.MANTLE_RPC_URL?.trim() || deployment.rpcUrl || fromEnv.rpcUrl,
    explorer: env.MANTLE_EXPLORER?.trim() || deployment.explorer || fromEnv.explorer,
    actionLogAddress: fromEnv.actionLogAddress ?? asHex(deployment.actionLog),
    identityRegistryAddress:
      fromEnv.identityRegistryAddress ?? asHex(deployment.identityRegistry),
    agentId,
  }
}

/**
 * Build the orchestrator-facing recorder (artifact + env aware). Returns undefined when no signer
 * can be resolved (no OWS EVM account and no MANTLE_RECORDER_PRIVATE_KEY). Safe to pass into the
 * orchestrators: recordDecision is best-effort and gated by MANTLE_RECORD_LIVE.
 */
export async function createMantleRecorder(input: {
  baseDir: string
  ows?: Pick<OwsClient, 'getEvmAddress' | 'signEvmHash'>
  walletName?: string
  env: Record<string, string | undefined>
}): Promise<MantleClient | undefined> {
  const account = resolveMantleAccount({ ows: input.ows, walletName: input.walletName, env: input.env })
  if (!account) return undefined
  const config = await loadMantleConfig(input.baseDir, input.env)
  return new MantleClient(config, account)
}
