/**
 * MantleClient — PalmOS's Mantle Sepolia layer: deploy contracts, mint the ERC-8004 agent
 * identity, and record governed decisions on-chain. Serves two callers:
 *   • scripts  — deploy / registerIdentity / reads (full lifecycle)
 *   • orchestrators — the narrow `MantleRecorder` (recordDecision) wired as an optional dep
 *
 * Two invariants make this safe to bolt onto the existing Solana settlement spine:
 *   1. recordDecision is BEST-EFFORT — it never throws into the orchestrator. A failed/unfunded/
 *      undeployed recorder must never break a governed swap or LP action; it just returns an error.
 *   2. Live writes are gated behind MANTLE_RECORD_LIVE (default off): by default it SIMULATES
 *      (eth_call, no gas, no broadcast) so a tool call can't surprise-spend MNT.
 *
 * Signer: the agent's OWS EVM account by default (same vault as its Solana key); falls back to a
 * viem private-key recorder via MANTLE_RECORDER_PRIVATE_KEY only if set.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  type Account,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { OwsClient } from '../ows/client.js'
import { createOwsEvmAccount } from './owsAccount.js'
import { AGENT_ACTION_LOG_ABI, IDENTITY_REGISTRY_ABI } from './abi.js'
import {
  MANTLE_SEPOLIA_EXPLORER,
  MANTLE_SEPOLIA_RPC_URL,
  mantleSepolia,
  mantleTxUrl,
} from './chain.js'

export type MantleConfig = {
  rpcUrl: string
  recordLive: boolean
  explorer: string
  actionLogAddress?: Hex
  identityRegistryAddress?: Hex
  /** Identity NFT token id minted for the acting agent (cross-links the decision log). */
  agentId?: bigint
}

export type MantleDecisionInput = {
  /** Identity token id; falls back to config.agentId. */
  agentId?: bigint
  /** PalmOS actionRequestId — hashed to the on-chain bytes32 actionId. */
  actionRequestId: string
  kind: string // asset.swap | asset.liquidity
  verdict: string // auto_approved | approval_required | denied
  outcome: string // executed | approval_pending | blocked | failed
  solanaSignature?: string // cross-chain settlement link
  amount?: bigint
  detail?: string
}

export type MantleRecordResult = {
  recorded: boolean
  simulated: boolean
  txHash?: Hex
  explorerUrl?: string
  seq?: bigint
  agentId?: bigint
  actionId?: Hex
  error?: string
}

/** Narrow surface the orchestrators depend on (structural dep, like owsClient/byrealClient). */
export interface MantleRecorder {
  readonly enabled: boolean
  readonly recordLive: boolean
  recordDecision(input: MantleDecisionInput): Promise<MantleRecordResult>
}

export type DeployResult = { address: Hex; txHash: Hex }

export function readMantleConfigFromEnv(
  env: Record<string, string | undefined>,
): MantleConfig {
  const asHex = (v?: string): Hex | undefined => {
    const t = v?.trim()
    return t && t.startsWith('0x') ? (t as Hex) : undefined
  }
  let agentId: bigint | undefined
  const rawAgentId = env.MANTLE_AGENT_ID?.trim()
  if (rawAgentId) {
    try {
      agentId = BigInt(rawAgentId)
    } catch {
      agentId = undefined
    }
  }
  return {
    rpcUrl: env.MANTLE_RPC_URL?.trim() || MANTLE_SEPOLIA_RPC_URL,
    recordLive: env.MANTLE_RECORD_LIVE === '1',
    explorer: env.MANTLE_EXPLORER?.trim() || MANTLE_SEPOLIA_EXPLORER,
    actionLogAddress: asHex(env.MANTLE_ACTION_LOG),
    identityRegistryAddress: asHex(env.MANTLE_IDENTITY_REGISTRY),
    agentId,
  }
}

export class MantleClient implements MantleRecorder {
  private readonly publicClient: PublicClient
  private readonly walletClient: WalletClient

  constructor(
    private readonly config: MantleConfig,
    private readonly account: Account,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(config.rpcUrl),
    })
    this.walletClient = createWalletClient({
      account,
      chain: mantleSepolia,
      transport: http(config.rpcUrl),
    })
  }

  get address(): Hex {
    return this.account.address
  }

  get enabled(): boolean {
    return Boolean(this.config.actionLogAddress)
  }

  get recordLive(): boolean {
    return this.config.recordLive
  }

  async getBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.account.address })
  }

  // ---- decision log (orchestrator path) ----

  /** Best-effort: never throws. Simulates unless MANTLE_RECORD_LIVE=1. */
  async recordDecision(input: MantleDecisionInput): Promise<MantleRecordResult> {
    const actionId = keccak256(toHex(input.actionRequestId))
    const agentId = input.agentId ?? this.config.agentId ?? 0n
    const base: MantleRecordResult = {
      recorded: false,
      simulated: false,
      agentId,
      actionId,
    }
    if (!this.config.actionLogAddress) {
      return { ...base, error: 'mantle action log not configured' }
    }
    const args = [
      agentId,
      actionId,
      input.kind,
      input.verdict,
      input.outcome,
      input.solanaSignature ?? '',
      input.amount ?? 0n,
      input.detail ?? '',
    ] as const
    try {
      const { request, result } = await this.publicClient.simulateContract({
        address: this.config.actionLogAddress,
        abi: AGENT_ACTION_LOG_ABI,
        functionName: 'recordDecision',
        args,
        account: this.account,
      })
      if (!this.config.recordLive) {
        return { ...base, simulated: true, seq: result as bigint }
      }
      const txHash = await this.walletClient.writeContract(request)
      await this.publicClient.waitForTransactionReceipt({ hash: txHash })
      return {
        ...base,
        recorded: true,
        txHash,
        explorerUrl: mantleTxUrl(txHash, this.config.explorer),
        seq: result as bigint,
      }
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ---- contract lifecycle (script path) ----

  async deploy(artifact: { abi: readonly unknown[]; bytecode: Hex }): Promise<DeployResult> {
    const txHash = await this.walletClient.deployContract({
      abi: artifact.abi as never,
      bytecode: artifact.bytecode,
      account: this.account,
      chain: mantleSepolia,
      args: [],
    })
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })
    if (!receipt.contractAddress) {
      throw new Error(`Deploy tx ${txHash} produced no contract address.`)
    }
    return { address: receipt.contractAddress, txHash }
  }

  async agentIdOf(owner: Hex, registry?: Hex): Promise<bigint> {
    const address = registry ?? this.config.identityRegistryAddress
    if (!address) throw new Error('identity registry address not configured')
    return this.publicClient.readContract({
      address,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'agentIdOf',
      args: [owner],
    }) as Promise<bigint>
  }

  async tokenURI(agentId: bigint, registry?: Hex): Promise<string> {
    const address = registry ?? this.config.identityRegistryAddress
    if (!address) throw new Error('identity registry address not configured')
    return this.publicClient.readContract({
      address,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'tokenURI',
      args: [agentId],
    }) as Promise<string>
  }

  /** Mint the agent identity NFT (idempotent — returns the existing id if already registered). */
  async registerIdentity(
    agentCardURI: string,
    registry?: Hex,
  ): Promise<{ agentId: bigint; txHash?: Hex; alreadyRegistered: boolean }> {
    const address = registry ?? this.config.identityRegistryAddress
    if (!address) throw new Error('identity registry address not configured')
    const existing = await this.agentIdOf(this.account.address, address)
    if (existing > 0n) {
      return { agentId: existing, alreadyRegistered: true }
    }
    const { request } = await this.publicClient.simulateContract({
      address,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'register',
      args: [agentCardURI],
      account: this.account,
    })
    const txHash = await this.walletClient.writeContract(request)
    await this.publicClient.waitForTransactionReceipt({ hash: txHash })
    const agentId = await this.agentIdOf(this.account.address, address)
    return { agentId, txHash, alreadyRegistered: false }
  }
}

/**
 * Resolve the Mantle signer account: prefer the agent's OWS EVM account (same vault as its Solana
 * key); fall back to a viem private-key recorder only if MANTLE_RECORDER_PRIVATE_KEY is set.
 */
export function resolveMantleAccount(input: {
  ows?: Pick<OwsClient, 'getEvmAddress' | 'signEvmHash'>
  walletName?: string
  env: Record<string, string | undefined>
}): Account | undefined {
  const key = input.env.MANTLE_RECORDER_PRIVATE_KEY?.trim()
  if (key) {
    return privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as Hex)
  }
  if (input.ows && input.walletName) {
    const evm = input.ows.getEvmAddress(input.walletName)
    if (evm) return createOwsEvmAccount(input.ows, input.walletName)
  }
  return undefined
}

/** Build a MantleClient from env + a signer. Returns undefined when no signer can be resolved. */
export function createMantleClientFromEnv(input: {
  ows?: Pick<OwsClient, 'getEvmAddress' | 'signEvmHash'>
  walletName?: string
  env: Record<string, string | undefined>
  config?: Partial<MantleConfig>
}): MantleClient | undefined {
  const account = resolveMantleAccount(input)
  if (!account) return undefined
  return new MantleClient({ ...readMantleConfigFromEnv(input.env), ...input.config }, account)
}
