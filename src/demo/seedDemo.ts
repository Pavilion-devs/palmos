import {
  DefaultSessionKernel,
  DeterministicSignerGateway,
  FileKernelPersistence,
  OwsWalletProvider,
  FileRunRegistry,
  FileSessionRegistry,
  FileWalletRegistry,
  type RuntimeEnvironment,
} from '../../runtime/index.js'
import { activateAgentWallet } from '../app/activateAgentWallet.js'
import { createAgentWallet } from '../app/createAgentWallet.js'
import { OwsClient } from '../integrations/ows/client.js'
import {
  PALMOS_LOCAL_DEMO_MERCHANT_WALLET,
  PUSD_SYMBOL,
  SOLANA_MAINNET_CHAIN_ID,
} from '../integrations/pusd/constants.js'
import {
  createAgentPolicyCandidateResolver,
  type AgentPolicyTemplateInput,
} from '../policies/compileAgentPolicy.js'
import {
  FileAgentRegistry,
  type AgentRecord,
} from '../store/AgentRegistry.js'
import { FileOwsAccessRegistry } from '../store/OwsAccessRegistry.js'

export type SeedDemoInput = {
  baseDir: string
  organizationId: string
  treasuryId?: string
  environment?: RuntimeEnvironment
  now?: () => string
  createId?: (prefix: string) => string
}

type DemoAgentSeed = {
  agentId: string
  displayName: string
  walletType: AgentPolicyTemplateInput['walletType']
  policyConfig: AgentPolicyTemplateInput
}

export const DEMO_AGENT_IDS = {
  marketMonitor: 'market_monitor_agent',
  vendorProcurement: 'vendor_procurement_agent',
  growthCampaign: 'growth_campaign_agent',
} as const

function buildDemoPolicies(
  input: SeedDemoInput,
  environment: RuntimeEnvironment,
  localDemoPayToAddress?: string,
): DemoAgentSeed[] {
  const localPusdVendor =
    localDemoPayToAddress ??
    process.env.PUSD_MERCHANT_WALLET ??
    PALMOS_LOCAL_DEMO_MERCHANT_WALLET

  return [
    {
      agentId: DEMO_AGENT_IDS.marketMonitor,
      displayName: 'Market Monitor Agent',
      walletType: 'ops',
      policyConfig: {
        agentId: DEMO_AGENT_IDS.marketMonitor,
        organizationId: input.organizationId,
        environment,
        walletType: 'ops',
        allowedChains: [SOLANA_MAINNET_CHAIN_ID],
        allowedAssets: [PUSD_SYMBOL],
        allowedSignerClasses: ['multisig'],
        allowedVendors: [
          {
            vendorId: 'local_pusd_demo',
            label: 'PUSD Market Data API',
            destinationAddress: localPusdVendor,
            chainId: SOLANA_MAINNET_CHAIN_ID,
          },
          {
            vendorId: 'palm_market_data',
            label: 'PalmOS Market Data',
            destinationAddress: localPusdVendor,
            chainId: SOLANA_MAINNET_CHAIN_ID,
          },
        ],
        autoApproveUnder: '0.10',
        maxPerTransaction: '25.00',
        heartbeatTimeoutSeconds: 900,
      },
    },
    {
      agentId: DEMO_AGENT_IDS.vendorProcurement,
      displayName: 'Vendor Procurement Agent',
      walletType: 'ops',
      policyConfig: {
        agentId: DEMO_AGENT_IDS.vendorProcurement,
        organizationId: input.organizationId,
        environment,
        walletType: 'ops',
        allowedChains: [SOLANA_MAINNET_CHAIN_ID],
        allowedAssets: [PUSD_SYMBOL],
        allowedSignerClasses: ['multisig'],
        allowedVendors: [
          {
            vendorId: 'ops_research_vendor',
            label: 'PUSD Ops Research Vendor',
            destinationAddress: localPusdVendor,
            chainId: SOLANA_MAINNET_CHAIN_ID,
          },
        ],
        autoApproveUnder: '0.10',
        maxPerTransaction: '120.00',
        heartbeatTimeoutSeconds: 900,
      },
    },
    {
      agentId: DEMO_AGENT_IDS.growthCampaign,
      displayName: 'Growth Campaign Agent',
      walletType: 'ops',
      policyConfig: {
        agentId: DEMO_AGENT_IDS.growthCampaign,
        organizationId: input.organizationId,
        environment,
        walletType: 'ops',
        allowedChains: [SOLANA_MAINNET_CHAIN_ID],
        allowedAssets: [PUSD_SYMBOL],
        allowedSignerClasses: ['multisig'],
        allowedVendors: [
          {
            vendorId: 'growth_email_vendor',
            label: 'Growth Email Vendor',
            destinationAddress: localPusdVendor,
            chainId: SOLANA_MAINNET_CHAIN_ID,
          },
        ],
        autoApproveUnder: '0.10',
        maxPerTransaction: '40.00',
        heartbeatTimeoutSeconds: 900,
      },
    },
  ]
}

export async function seedDemo(input: SeedDemoInput): Promise<{
  kernel: DefaultSessionKernel
  agentRegistry: FileAgentRegistry
  walletRegistry: FileWalletRegistry
  agents: AgentRecord[]
}> {
  const environment = input.environment ?? 'production'
  const now = input.now ?? (() => new Date().toISOString())
  const localDemoPayToAddress = process.env.PUSD_MERCHANT_WALLET

  const agentRegistry = new FileAgentRegistry(input.baseDir)
  const walletRegistry = new FileWalletRegistry(input.baseDir)
  const owsClient = OwsClient.fromEnv(input.baseDir)
  const owsAccessRegistry = new FileOwsAccessRegistry(input.baseDir)
  const kernel = new DefaultSessionKernel({
    persistence: new FileKernelPersistence(input.baseDir),
    sessions: new FileSessionRegistry(input.baseDir),
    runs: new FileRunRegistry(input.baseDir),
    walletRegistry,
    walletProvider:
      owsClient != null
        ? new OwsWalletProvider({
            registry: walletRegistry,
            vaultPath: owsClient.vaultPath,
          })
        : undefined,
    signerGateway: new DeterministicSignerGateway('pending'),
    getPolicyCandidates: createAgentPolicyCandidateResolver({
      agentRegistry,
      now,
    }),
    now,
    createId: input.createId,
  })

  const seeds = buildDemoPolicies(input, environment, localDemoPayToAddress)
  const agents: AgentRecord[] = []

  for (const seed of seeds) {
    const result = await createAgentWallet(
      {
        kernel,
        agentRegistry,
        walletRegistry,
        owsClient,
        owsAccessRegistry,
        now,
      },
      {
        agentId: seed.agentId,
        displayName: seed.displayName,
        organizationId: input.organizationId,
        treasuryId: input.treasuryId,
        environment,
        managerActorId: 'manager_demo',
        managerRoleIds: ['manager'],
        walletType: seed.walletType,
        subjectType: seed.walletType === 'vendor' ? 'business' : 'team',
        policyConfig: seed.policyConfig,
      },
    )
    const activatedAgent =
      seed.walletType === 'ops'
        ? await activateAgentWallet(
            {
              agentRegistry,
              walletRegistry,
              now,
            },
            {
              agentId: seed.agentId,
              targetState: 'active_limited',
            },
          )
        : result.agent
    agents.push(activatedAgent)
  }

  return {
    kernel,
    agentRegistry,
    walletRegistry,
    agents,
  }
}
