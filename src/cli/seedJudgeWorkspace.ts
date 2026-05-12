import {
  buildShowcaseSnapshot,
  createDefaultPalmosServiceCatalog,
  DEMO_AGENT_IDS,
  executePaidServiceCall,
  loadAgentSpendWorkspace,
  loadProcessEnv,
  PalmosClient,
  resetAgentSpendWorkspace,
  seedDemo,
} from '../index.js'

const env = loadProcessEnv()
const baseDir = env.AGENT_SPEND_OS_BASE_DIR?.trim() || '/tmp/palmos-live'
const seedEnv = {
  ...env,
  OWS_ENABLED:
    env.PALMOS_JUDGE_SEED_ATTACH_OWS === '1' ? env.OWS_ENABLED : '0',
}
process.env.OWS_ENABLED = seedEnv.OWS_ENABLED
const localDemoBaseUrl =
  env.PUSD_DEMO_SERVER_BASE_URL?.trim() || 'http://127.0.0.1:4021'

await resetAgentSpendWorkspace({
  baseDir,
  env: seedEnv,
})

const seeded = await seedDemo({
  baseDir,
  organizationId: env.PALMOS_ORG_ID?.trim() || 'org_demo',
  treasuryId: env.PALMOS_TREASURY_ID?.trim() || 'treasury_demo',
})
const workspace = loadAgentSpendWorkspace({ baseDir })
const serviceCatalog = createDefaultPalmosServiceCatalog({
  localDemoBaseUrl,
  localDemoSpotPriceAmount: env.PUSD_DEMO_SPOT_PRICE,
  localDemoOpsBriefAmount: env.PUSD_DEMO_OPS_BRIEF_PRICE,
})
const sharedDeps = {
  kernel: workspace.kernel,
  agentRegistry: workspace.agentRegistry,
  paidCalls: workspace.paidCallRegistry,
  palmosClient: PalmosClient.fromEnv(env),
  serviceCatalog,
}

const marketMonitor = await executePaidServiceCall(sharedDeps, {
  agentId: DEMO_AGENT_IDS.marketMonitor,
  serviceId: 'palmos.intel.onchain_flow',
  request: {
    base: 'BTC',
    quote: 'USD',
  },
})

const vendorProcurement = await executePaidServiceCall(sharedDeps, {
  agentId: DEMO_AGENT_IDS.vendorProcurement,
  serviceId: 'palmos.research.defi_risk',
  request: {
    symbols: ['BTC', 'ETH', 'SOL'],
    focus: 'ops market pulse',
  },
})

const growthCampaign = await executePaidServiceCall(sharedDeps, {
  agentId: DEMO_AGENT_IDS.growthCampaign,
  serviceId: 'palmos.research.defi_risk',
  request: {
    symbols: ['BTC', 'ETH'],
    focus: 'growth budget check',
  },
})

const snapshot = await buildShowcaseSnapshot({ baseDir })

console.log(
  JSON.stringify(
    {
      ok: true,
      baseDir,
      localDemoBaseUrl,
      agents: seeded.agents.map((agent) => ({
        id: agent.agentId,
        name: agent.displayName,
        status: agent.status,
        settlementMode: agent.settlementMode,
      })),
      outcomes: {
        marketMonitor: marketMonitor.kind,
        vendorProcurement: vendorProcurement.kind,
        growthCampaign: growthCampaign.kind,
      },
      summary: snapshot.summary,
    },
    null,
    2,
  ),
)
