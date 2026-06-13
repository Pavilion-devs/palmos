/**
 * Verify C3 (requestAssetSwap) — the governed-swap orchestration — end to end, offline.
 *
 * Uses the REAL ByrealClient + REAL OwsClient (throwaway vault) with in-memory agent/action-request
 * registries and simulateSettlement=true (OWS signs but never broadcasts; no funds move). Proves
 * the policy gate routes correctly and that an auto-approved swap drives C1+C2 to a signed result.
 *
 * Run from the worktree:  node --import tsx scripts/verify-c3-request-swap.ts
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OwsClient } from '../src/integrations/ows/client.js'
import { createByrealClient } from '../src/integrations/byreal/client.js'
import {
  requestAssetSwap,
  type RequestAssetSwapDependencies,
  type RequestAssetSwapInput,
} from '../src/app/requestAssetSwap.js'
import type { ActionRequestRecord } from '../src/store/ActionRequestRegistry.js'
import type { AgentRecord } from '../src/store/AgentRegistry.js'

const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'

async function main() {
  let failures = 0
  const ok = (label: string, cond: boolean, extra = '') => {
    console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`)
    if (!cond) failures++
  }

  // Throwaway OWS vault + wallet (the agent's governed wallet)
  const home = mkdtempSync(join(tmpdir(), 'palmos-c3-'))
  const ows = new OwsClient({ enabled: true, homeDir: home, vaultPath: join(home, '.ows'), passphrase: 'c3-verify' })
  await ows.ensureWallet({ name: 'c3swap' })
  const byreal = createByrealClient()

  const baseAgent = {
    agentId: 'agent_c3',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    displayName: 'C3 Test Agent',
    organizationId: 'org_test',
    environment: 'development',
    actorId: 'actor_c3',
    sessionId: 'session_c3',
    walletType: 'custodial',
    walletId: 'wallet_c3',
    walletBackend: 'ows',
    owsWalletName: 'c3swap',
    trustTier: 'healthy',
    status: 'ready',
    lastCheckInAt: new Date().toISOString(),
    policyConfig: {
      walletType: 'custodial',
      allowedAssets: ['SOL', 'USDC'],
      allowedChains: ['solana'],
      autoApproveUnder: '10',
      maxPerTransaction: '100',
      allowedVendors: [],
    },
  } as unknown as AgentRecord

  // Fresh agent + registries per scenario so policy outcomes don't bleed across runs.
  async function run(input: RequestAssetSwapInput) {
    let agent: AgentRecord = { ...baseAgent }
    const stored: ActionRequestRecord[] = []
    const deps: RequestAssetSwapDependencies = {
      agentRegistry: { get: async () => agent, put: async (a) => void (agent = a) },
      actionRequests: { put: async (r) => void stored.push(r) },
      byrealClient: byreal,
      owsClient: ows,
      simulateSettlement: true,
    }
    const result = await requestAssetSwap(deps, input)
    return { result, final: stored[stored.length - 1] }
  }

  const base = { agentId: 'agent_c3', inputMint: SOL, slippageBps: 100 }

  // 1. Auto-approved (0.01 SOL < autoApproveUnder 10) -> executed via Byreal+OWS (simulated)
  {
    const { result, final } = await run({ ...base, outputMint: USDC, inputAssetSymbol: 'SOL', outputAssetSymbol: 'USDC', amount: '0.01' })
    const ctx = final.requestContext as Record<string, unknown> | undefined
    ok(
      'auto-approved swap -> executed',
      result.kind === 'executed' && final.status === 'executed' && ctx?.settlementVia === 'byreal' && ctx?.settlementSimulated === true,
      `expectedOut ${String(ctx?.expectedOutAmount)} USDC, router ${String(ctx?.settlementRouter)}`,
    )
  }

  // 2. Approval required (50 SOL > autoApproveUnder 10, <= max 100)
  {
    const { result, final } = await run({ ...base, outputMint: USDC, inputAssetSymbol: 'SOL', outputAssetSymbol: 'USDC', amount: '50' })
    ok('over auto-approve threshold -> approval_pending', result.kind === 'approval_pending' && final.status === 'approval_pending' && final.policy.approvalRequired === true)
  }

  // 3. Denied — output asset not allowlisted
  {
    const { result, final } = await run({ ...base, outputMint: BONK, inputAssetSymbol: 'SOL', outputAssetSymbol: 'BONK', amount: '0.01' })
    ok('disallowed output asset -> blocked', result.kind === 'blocked' && final.status === 'blocked' && final.errorCode === 'policy.swap_asset_not_allowed', String(final.errorMessage))
  }

  // 4. Denied — amount exceeds the effective limit (200 SOL > max 100)
  {
    const { result, final } = await run({ ...base, outputMint: USDC, inputAssetSymbol: 'SOL', outputAssetSymbol: 'USDC', amount: '200' })
    ok('over max-per-swap limit -> blocked', result.kind === 'blocked' && final.errorCode === 'policy.swap_amount_exceeds_limit', String(final.errorMessage))
  }

  console.log(`\n${failures === 0 ? '✅ C3 requestAssetSwap: governance gate + settlement all pass' : `❌ ${failures} check(s) failed`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verify crashed:', e)
  process.exit(2)
})
