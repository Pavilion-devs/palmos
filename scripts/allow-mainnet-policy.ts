// Add solana-mainnet to the Main agent's allowed chains so mainnet Byreal actions aren't
// policy-denied (it was provisioned devnet-only). One-off setup for the live demo.
import { FileAgentRegistry } from '../src/store/AgentRegistry.js'

const baseDir = process.env.PALMOS_BASE_DIR ?? '/tmp/palmos-live'
const agents = new FileAgentRegistry(baseDir)
const all = await agents.list()
const a = all.find((x) => x.walletId) ?? all[0]
if (!a) throw new Error(`no agent in ${baseDir}`)

const chains = new Set(a.policyConfig.allowedChains ?? [])
chains.add('solana-mainnet')
const updated = {
  ...a,
  policyConfig: { ...a.policyConfig, allowedChains: [...chains] },
  updatedAt: new Date().toISOString(),
}
await agents.put(updated)
console.log(`${a.displayName}: allowedChains = ${JSON.stringify(updated.policyConfig.allowedChains)}`)
