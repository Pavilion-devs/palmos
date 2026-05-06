import type {
  WalletLifecycleState,
  WalletRegistry,
} from '../../runtime/index.js'
import type { AgentRegistry, AgentRecord } from '../store/AgentRegistry.js'

export type ActivateAgentWalletInput = {
  agentId: string
  targetState: Extract<
    WalletLifecycleState,
    'active_receive_only' | 'active_limited' | 'active_full'
  >
}

export type ActivateAgentWalletDependencies = {
  agentRegistry: AgentRegistry
  walletRegistry: WalletRegistry
  now?: () => string
}

export async function activateAgentWallet(
  deps: ActivateAgentWalletDependencies,
  input: ActivateAgentWalletInput,
): Promise<AgentRecord> {
  const agent = await deps.agentRegistry.get(input.agentId)
  if (!agent) {
    throw new Error(`Unknown agent: ${input.agentId}`)
  }

  if (!agent.walletId) {
    throw new Error(`Agent ${input.agentId} does not have a wallet to activate.`)
  }

  const wallet = await deps.walletRegistry.get(agent.walletId)
  if (!wallet) {
    throw new Error(`Wallet ${agent.walletId} was not found in the wallet registry.`)
  }

  const at = deps.now?.() ?? new Date().toISOString()
  const updatedWallet = {
    ...wallet,
    updatedAt: at,
    state: input.targetState,
    complianceStatus: 'approved' as const,
    policyAttachmentStatus: 'attached' as const,
    signerHealthStatus: 'healthy' as const,
    trustStatus: 'sufficient' as const,
  }
  await deps.walletRegistry.put(updatedWallet)

  const updatedAgent: AgentRecord = {
    ...agent,
    updatedAt: at,
    walletState: updatedWallet.state,
    status: 'ready',
  }
  await deps.agentRegistry.put(updatedAgent)

  return updatedAgent
}
