import { FileAgentRegistry } from '../src/store/AgentRegistry.js'
import { OwsClient } from '../src/integrations/ows/client.js'

const baseDir = process.env.PALMOS_BASE_DIR ?? '/tmp/palmos-live'
const agents = new FileAgentRegistry(baseDir)
const all = await agents.list()
const a = all.find((x) => x.walletId) ?? all[0]
if (!a) throw new Error(`no agent in ${baseDir}`)
const ows = OwsClient.fromEnv(baseDir, { ...process.env, OWS_ENABLED: '1' })
const walletName = a.owsWalletName ?? a.owsWalletId ?? a.agentId
const solanaAddress = ows?.getSolanaAddress(walletName)
console.log(
  JSON.stringify(
    {
      displayName: a.displayName,
      agentId: a.agentId,
      status: a.status,
      walletBackend: a.walletBackend,
      walletName,
      solanaAddress,
      trustTier: a.trustTier,
      policy: {
        allowedAssets: a.policyConfig?.allowedAssets,
        allowedChains: a.policyConfig?.allowedChains,
        maxPerTransaction: a.policyConfig?.maxPerTransaction,
        autoApproveUnder: a.policyConfig?.autoApproveUnder,
      },
    },
    null,
    2,
  ),
)
