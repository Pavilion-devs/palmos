import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateLiquidityRequest,
  evaluateSwapRequest,
  type AgentPolicyTemplateInput,
} from '../src/policies/compileAgentPolicy.js'

const POOL_A = '9GTj99g9tbz9U6UYDsX6YeRTgUnkYG6GTnHv3qLa5aXq' // vetted SOL/USDC pool
const POOL_B = 'EXOTICpoolNotOnTheAllowlist1111111111111111'

function policy(overrides: Partial<AgentPolicyTemplateInput> = {}): AgentPolicyTemplateInput {
  return {
    agentId: 'agent_risk_test',
    organizationId: 'org_test',
    environment: 'test',
    walletType: 'treasury',
    allowedChains: ['solana-mainnet'],
    allowedAssets: ['USDC', 'SOL'],
    allowedVendors: [],
    autoApproveUnder: '1',
    maxPerTransaction: '10',
    heartbeatTimeoutSeconds: 300,
    ...overrides,
  }
}

const swap = (slippageBps: number | undefined, p: AgentPolicyTemplateInput) =>
  evaluateSwapRequest({
    policy: p,
    inputAssetSymbol: 'USDC',
    outputAssetSymbol: 'SOL',
    inputAmount: '0.05',
    chainId: 'solana-mainnet',
    trustTier: 'healthy',
    slippageBps,
  })

const open = (poolId: string | undefined, slippageBps: number | undefined, p: AgentPolicyTemplateInput) =>
  evaluateLiquidityRequest({
    policy: p,
    op: 'open',
    depositAssetSymbol: 'USDC',
    depositAmount: '0.05',
    poolId,
    slippageBps,
    chainId: 'solana-mainnet',
    trustTier: 'healthy',
  })

test('swap slippage above the maxSlippageBps cap is denied', () => {
  const d = swap(200, policy({ maxSlippageBps: 100 }))
  assert.equal(d.status, 'denied')
  assert.equal(d.reasonCode, 'policy.swap_slippage_exceeds_cap')
})

test('swap slippage at/under the cap is allowed', () => {
  const d = swap(50, policy({ maxSlippageBps: 100 }))
  assert.equal(d.status, 'allowed')
  assert.equal(d.reasonCode, 'policy.swap_auto_approved')
})

test('no slippage cap configured = no slippage restriction', () => {
  const d = swap(500, policy())
  assert.equal(d.status, 'allowed')
})

test('liquidity into an unvetted pool is denied (risk allowlist)', () => {
  const d = open(POOL_B, undefined, policy({ allowedPools: [POOL_A] }))
  assert.equal(d.status, 'denied')
  assert.equal(d.reasonCode, 'policy.liquidity_pool_not_allowed')
  assert.equal(d.disallowedPool, POOL_B)
})

test('liquidity into a vetted pool is allowed', () => {
  const d = open(POOL_A, undefined, policy({ allowedPools: [POOL_A] }))
  assert.equal(d.status, 'allowed')
  assert.equal(d.reasonCode, 'policy.liquidity_auto_approved')
})

test('no allowedPools configured = any pool allowed', () => {
  const d = open(POOL_B, undefined, policy())
  assert.equal(d.status, 'allowed')
})

test('liquidity slippage above the cap is denied', () => {
  const d = open(POOL_A, 250, policy({ allowedPools: [POOL_A], maxSlippageBps: 100 }))
  assert.equal(d.status, 'denied')
  assert.equal(d.reasonCode, 'policy.liquidity_slippage_exceeds_cap')
})

test('pool allowlist does not apply to withdrawals (close returns own funds)', () => {
  const d = evaluateLiquidityRequest({
    policy: policy({ allowedPools: [POOL_A] }),
    op: 'close',
    poolId: POOL_B, // irrelevant for a withdraw — should still auto-approve
    chainId: 'solana-mainnet',
    trustTier: 'healthy',
  })
  assert.equal(d.status, 'allowed')
  assert.equal(d.reasonCode, 'policy.liquidity_auto_approved')
})
