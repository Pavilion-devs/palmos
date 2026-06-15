/**
 * Provision a FRESH "Main" agent + OWS vault in a DURABLE baseDir (NOT /tmp — the old vault was
 * wiped when /tmp got cleared on reboot, stranding its keys + funds). Creates a new OWS wallet
 * (one seed → Solana + EVM accounts: "one vault, two chains") and writes a ready, OWS-backed agent
 * record with a mainnet Byreal-swap policy that auto-approves a 0.05 USDC swap.
 *
 * Idempotent: if "main" already exists, just prints its addresses.
 * Run:  PALMOS_BASE_DIR=~/palmos-live node --import tsx scripts/provision-main.ts
 */
import { FileAgentRegistry, type AgentRecord } from '../src/store/AgentRegistry.js'
import { FileWalletRegistry } from '../runtime/index.js'
import type { WalletRecord } from '../runtime/index.js'
import { OwsClient } from '../src/integrations/ows/client.js'
import type { AgentPolicyTemplateInput } from '../src/policies/compileAgentPolicy.js'

const baseDir = process.env.PALMOS_BASE_DIR ?? '/tmp/palmos-live'
if (baseDir.startsWith('/tmp/')) {
  console.error(`❌ Refusing to provision into ephemeral ${baseDir}. Set PALMOS_BASE_DIR to a durable path.`)
  process.exit(1)
}

const AGENT_ID = 'main'
const ORG_ID = 'palmos'

const agents = new FileAgentRegistry(baseDir)
const ows = OwsClient.fromEnv(baseDir, { ...process.env, OWS_ENABLED: '1' })
if (!ows) throw new Error('OWS is disabled')

const binding = await ows.ensureWallet({ name: AGENT_ID })
const solanaAddress = binding.solanaAddress
const evmAddress = binding.evmAddress
if (!solanaAddress || !evmAddress) {
  throw new Error(`OWS wallet missing accounts (solana=${solanaAddress} evm=${evmAddress})`)
}

const existing = await agents.get(AGENT_ID)
const at = new Date().toISOString()

const policyConfig: AgentPolicyTemplateInput = {
  agentId: AGENT_ID,
  organizationId: ORG_ID,
  environment: 'production',
  walletType: 'ops',
  // mainnet FIRST so deposit detection / default chain pick mainnet (memory: allowedChains[0]).
  allowedChains: ['solana-mainnet', 'solana-devnet'],
  allowedAssets: ['SOL', 'USDC'],
  allowedVendors: [],
  // trustTier 'new' => 0.25x multiplier on maxPerTransaction => effective 0.5 USDC per swap.
  // autoApproveUnder 0.1 => a 0.05 USDC swap auto-approves and settles autonomously.
  autoApproveUnder: '0.1',
  maxPerTransaction: '2',
  heartbeatTimeoutSeconds: 60,
  policyProfileId: `policy_agent_${AGENT_ID}`,
}

const agent: AgentRecord = {
  agentId: AGENT_ID,
  createdAt: existing?.createdAt ?? at,
  updatedAt: at,
  displayName: 'Main',
  organizationId: ORG_ID,
  environment: 'production',
  actorId: `agent:${AGENT_ID}`,
  sessionId: `agent:${AGENT_ID}`,
  walletType: 'ops',
  settlementMode: 'ows',
  walletId: binding.wallet.id,
  walletBackend: 'ows',
  owsWalletId: binding.wallet.id,
  owsWalletName: binding.wallet.name,
  owsVaultPath: ows.vaultPath,
  policyProfileId: `policy_agent_${AGENT_ID}`,
  policyConfig,
  trustTier: 'new',
  status: 'ready',
  lastCheckInAt: at,
}

await agents.put(agent)

// WalletRegistry record — the dashboard / get_wallet_context resolve the on-chain address from
// HERE (wallet.address), so the portfolio reader knows which Solana account to query. Without it
// the agent sees a $0 wallet.
const wallets = new FileWalletRegistry(baseDir)
const walletRecord: WalletRecord = {
  walletId: binding.wallet.id,
  createdAt: existing?.createdAt ?? at,
  updatedAt: at,
  state: 'active_full',
  organizationId: ORG_ID,
  subjectId: AGENT_ID,
  walletType: 'ops',
  address: solanaAddress,
  supportedChains: ['solana-mainnet', 'solana-devnet'],
  providerId: 'ows_wallet_provider',
  providerWalletId: binding.wallet.id,
  providerWalletName: binding.wallet.name,
  providerVaultPath: ows.vaultPath,
  complianceStatus: 'approved',
  policyAttachmentStatus: 'attached',
  signerHealthStatus: 'healthy',
  trustStatus: 'sufficient',
}
await wallets.put(walletRecord)

console.log(JSON.stringify({
  baseDir,
  vaultPath: ows.vaultPath,
  agentId: AGENT_ID,
  displayName: 'Main',
  status: agent.status,
  walletBackend: agent.walletBackend,
  owsWalletName: agent.owsWalletName,
  solanaAddress,   // FUND THIS: small SOL (fees) + USDC (swap input)
  evmAddress,      // FUND THIS: test MNT from https://faucet.sepolia.mantle.xyz
  alreadyExisted: Boolean(existing),
}, null, 2))
