/**
 * Demo-prep: apply the Byreal risk policy to the agent — `allowedPools` (vetted-pool allowlist) and
 * `maxSlippageBps` — so a liquidity deposit into any other pool is denied (the risk money-shot).
 * Idempotent + additive (only sets the two risk fields). Run against the durable workspace:
 *   PALMOS_BASE_DIR=~/palmos-live node --import tsx scripts/apply-risk-policy.ts
 */
import { FileAgentRegistry } from '../src/store/AgentRegistry.js'

// The vetted SOL/USDC CLMM pool (confirmed in scripts/preflight-demo.ts: ~$71, 4bps, ~32% APR).
const VETTED_POOL = '9GTj99g9tbz9U6UYDsX6YeRTgUnkYG6GTnHv3qLa5aXq'
// 5% — loose enough to clear the SOL/USDC pool's variable impact (it can spike to ~2.4% on a tiny
// swap when the active liquidity range is thin). The risk *deny* in the demo is the pool allowlist,
// not slippage; this cap is just a present-but-non-interfering control.
const MAX_SLIPPAGE_BPS = 500

const baseDir = process.env.PALMOS_BASE_DIR ?? '/Users/olathepavilion/palmos-live'
const agents = new FileAgentRegistry(baseDir)
const all = await agents.list()
const agent = all.find((a) => a.walletId) ?? all[0]
if (!agent) throw new Error(`No agent in ${baseDir}`)

const next = {
  ...agent,
  updatedAt: new Date().toISOString(),
  policyConfig: {
    ...agent.policyConfig,
    allowedPools: [VETTED_POOL],
    maxSlippageBps: MAX_SLIPPAGE_BPS,
  },
}
await agents.put(next)

console.log(`✅ Risk policy applied to agent "${agent.displayName ?? agent.agentId}"`)
console.log(`   allowedPools: [${VETTED_POOL}]`)
console.log(`   maxSlippageBps: ${MAX_SLIPPAGE_BPS}`)
console.log('   (a liquidity deposit into any other pool → policy.liquidity_pool_not_allowed)')
