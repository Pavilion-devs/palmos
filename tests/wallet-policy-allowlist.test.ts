import assert from 'node:assert/strict'
import test from 'node:test'
import { readTransferPolicyPatch } from '../src/server/dashboard/serviceInput.js'
import { requestWalletPolicyUpdate } from '../src/app/requestWalletPolicyUpdate.js'
import { InMemoryActionRequestRegistry } from '../src/store/ActionRequestRegistry.js'
import {
  InMemoryAgentRegistry,
  type AgentRecord,
} from '../src/store/AgentRegistry.js'

const NOW = '2026-06-12T00:00:00.000Z'
// Real, valid base58 Solana pubkeys used as allowlist fixtures.
const ADDR_A = '4LermEmh8qcN5Kq8wk6ALFHT1PaKFDcLK3a1PcPk3XW6'
const ADDR_B = '11111111111111111111111111111111'

function createAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: 'agent_policy_test',
    createdAt: NOW,
    updatedAt: NOW,
    displayName: 'Policy Test Agent',
    organizationId: 'org_test',
    treasuryId: 'treasury_test',
    environment: 'test',
    actorId: 'actor_test',
    sessionId: 'session_test',
    walletType: 'ops',
    walletId: 'wallet_test',
    walletState: 'active_full',
    signerProfileId: 'multisig_default',
    policyProfileId: 'policy_test',
    policyConfig: {
      agentId: 'agent_policy_test',
      organizationId: 'org_test',
      environment: 'test',
      walletType: 'ops',
      allowedChains: ['solana-devnet'],
      allowedAssets: ['SOL'],
      allowedSignerClasses: ['multisig'],
      allowedVendors: [],
      autoApproveUnder: '5',
      maxPerTransaction: '25',
      transferPolicy: {
        allowedRecipients: [
          {
            counterpartyId: 'existing',
            label: 'Existing',
            destinationAddress: ADDR_A,
            chainId: 'solana-devnet',
          },
        ],
        allowedAssets: ['SOL'],
        allowedChains: ['solana-devnet'],
      },
      heartbeatTimeoutSeconds: 300,
      policyProfileId: 'policy_test',
    },
    trustTier: 'healthy',
    status: 'ready',
    lastCheckInAt: NOW,
    ...overrides,
  }
}

test('readTransferPolicyPatch normalizes recipients, assets, and chains', () => {
  const patch = readTransferPolicyPatch({
    allowedRecipients: [
      { destinationAddress: ADDR_A, chainId: 'solana-devnet', label: 'Vendor' },
      // duplicate of the first — dropped
      { destinationAddress: ADDR_A, chainId: 'solana-devnet' },
      // invalid base58 on a solana chain — dropped
      { destinationAddress: 'not-a-valid-address', chainId: 'solana-devnet' },
      // missing chainId — dropped
      { destinationAddress: ADDR_B },
    ],
    allowedAssets: ['sol', 'SOL', 'usdc'],
    allowedChains: ['solana-devnet', 'solana-devnet'],
  })

  assert.ok(patch)
  assert.equal(patch?.allowedRecipients?.length, 1)
  assert.equal(patch?.allowedRecipients?.[0].destinationAddress, ADDR_A)
  assert.equal(patch?.allowedRecipients?.[0].label, 'Vendor')
  // counterpartyId is synthesized when omitted
  assert.ok(patch?.allowedRecipients?.[0].counterpartyId)
  assert.deepEqual(patch?.allowedAssets, ['SOL', 'USDC'])
  assert.deepEqual(patch?.allowedChains, ['solana-devnet'])
})

test('readTransferPolicyPatch distinguishes omitted (untouched) from empty (lockdown)', () => {
  // No transferPolicy at all
  assert.equal(readTransferPolicyPatch(undefined), undefined)
  // transferPolicy present but with no recognized arrays → nothing to apply
  assert.equal(readTransferPolicyPatch({}), undefined)
  // explicit empty arrays are an intentional deny-all and are preserved
  const lockdown = readTransferPolicyPatch({
    allowedRecipients: [],
    allowedAssets: [],
    allowedChains: [],
  })
  assert.deepEqual(lockdown, {
    allowedRecipients: [],
    allowedAssets: [],
    allowedChains: [],
  })
})

test('requestWalletPolicyUpdate applies an allowlist edit to transferPolicy', async () => {
  const agentRegistry = new InMemoryAgentRegistry([createAgent()])
  const actionRequests = new InMemoryActionRequestRegistry()

  const result = await requestWalletPolicyUpdate(
    { agentRegistry, actionRequests, now: () => NOW },
    {
      agentId: 'agent_policy_test',
      patch: {
        transferPolicy: {
          allowedRecipients: [
            {
              counterpartyId: 'existing',
              label: 'Existing',
              destinationAddress: ADDR_A,
              chainId: 'solana-devnet',
            },
            {
              counterpartyId: 'new_dest',
              label: 'New Destination',
              destinationAddress: ADDR_B,
              chainId: 'solana-devnet',
            },
          ],
          allowedAssets: ['SOL', 'USDC'],
        },
      },
    },
  )

  assert.equal(result.kind, 'executed')
  const saved = await agentRegistry.get('agent_policy_test')
  const tp = saved?.policyConfig.transferPolicy
  assert.equal(tp?.allowedRecipients?.length, 2)
  assert.ok(
    tp?.allowedRecipients?.some((r) => r.destinationAddress === ADDR_B),
    'newly allowlisted destination should be present',
  )
  // assets replaced, chains left untouched (not in the patch)
  assert.deepEqual(tp?.allowedAssets, ['SOL', 'USDC'])
  assert.deepEqual(tp?.allowedChains, ['solana-devnet'])
})

test('requestWalletPolicyUpdate leaves transferPolicy untouched when not patched', async () => {
  const agentRegistry = new InMemoryAgentRegistry([createAgent()])
  const actionRequests = new InMemoryActionRequestRegistry()

  const result = await requestWalletPolicyUpdate(
    { agentRegistry, actionRequests, now: () => NOW },
    {
      agentId: 'agent_policy_test',
      patch: { maxPerTransaction: '50' },
    },
  )

  assert.equal(result.kind, 'executed')
  const saved = await agentRegistry.get('agent_policy_test')
  assert.equal(saved?.policyConfig.maxPerTransaction, '50')
  // unchanged
  assert.equal(saved?.policyConfig.transferPolicy?.allowedRecipients?.length, 1)
  assert.equal(
    saved?.policyConfig.transferPolicy?.allowedRecipients?.[0].destinationAddress,
    ADDR_A,
  )
})
