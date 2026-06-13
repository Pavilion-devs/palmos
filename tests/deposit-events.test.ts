import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveLiveDepositEvents } from '../src/server/dashboard/dashboardTransactions.js'
import type { AgentRecord } from '../src/store/AgentRegistry.js'
import type { WalletPortfolioTransaction } from '../src/integrations/portfolio/types.js'

const agent = { agentId: 'a1', displayName: 'Main', walletId: 'w1' } as AgentRecord

function tx(
  overrides: Partial<WalletPortfolioTransaction> = {},
): WalletPortfolioTransaction {
  return {
    id: 'tx_1',
    hash: 'tx_1',
    chainId: 'solana-devnet',
    minedAt: '2026-06-12T00:00:00Z',
    ...overrides,
  }
}

test('deriveLiveDepositEvents maps inbound live deposits into agent events', () => {
  const events = deriveLiveDepositEvents(agent, [
    tx({
      id: 'tx_sol',
      minedAt: '2026-06-12T00:00:00Z',
      operationType: 'deposit',
      direction: 'in',
      assetSymbol: 'SOL',
      amount: 2.3,
    }),
    tx({
      id: 'tx_usdc',
      hash: 'tx_usdc',
      minedAt: '2026-06-12T01:00:00Z',
      operationType: 'deposit',
      direction: 'in',
      assetSymbol: 'USDC',
      amount: 20,
    }),
  ])
  const summaries = events.map((e) => e.summary)
  assert.equal(summaries.length, 2)
  assert.match(summaries[0], /received 2\.3 SOL/)
  assert.match(summaries[1], /received 20 USDC/)
  // stable, unique ids
  assert.equal(new Set(events.map((e) => e.id)).size, 2)
  assert.ok(events.every((e) => e.eventType === 'deposit.detected'))
})

test('deriveLiveDepositEvents ignores outbound, swap, and incomplete rows', () => {
  const events = deriveLiveDepositEvents(agent, [
    tx({
      id: 'tx_send',
      operationType: 'send',
      direction: 'out',
      assetSymbol: 'SOL',
      amount: 0.1,
    }),
    tx({
      id: 'tx_swap',
      operationType: 'swap',
      direction: 'in',
      assetSymbol: 'USDC',
      amount: 20,
    }),
    tx({
      id: 'tx_missing_amount',
      operationType: 'deposit',
      direction: 'in',
      assetSymbol: 'USDC',
    }),
  ])
  assert.deepEqual(events, [])
})
