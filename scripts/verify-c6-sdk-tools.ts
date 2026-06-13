/**
 * Verify C6 — the agent-facing SDK tool surface for Byreal swaps.
 *
 * Checks tool discovery (what an agent sees from SDK_TOOL_DEFINITIONS) and input parsing
 * (number coercion, swapMode validation, nested {input:{...}} vs flat payloads). The handler
 * dispatch itself just calls requestAssetSwap (C3) / ByrealClient.quoteSwap (C1), both already
 * verified, and the whole wiring typechecks under the project tsc.
 *
 * Run from the worktree:  node --import tsx scripts/verify-c6-sdk-tools.ts
 */
import {
  SDK_TOOL_DEFINITIONS,
  isSdkToolName,
  readSdkSwapRequestInput,
  readSdkQuoteRequestInput,
} from '../src/server/dashboard/sdkTools.js'

function main() {
  let failures = 0
  const ok = (label: string, cond: boolean, extra = '') => {
    console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`)
    if (!cond) failures++
  }

  // Discovery
  ok('request_asset_swap registered', isSdkToolName('request_asset_swap'))
  ok('get_byreal_quote registered', isSdkToolName('get_byreal_quote'))

  const swapDef = SDK_TOOL_DEFINITIONS.find((d) => d.name === 'request_asset_swap')
  const quoteDef = SDK_TOOL_DEFINITIONS.find((d) => d.name === 'get_byreal_quote')
  const req = (d: typeof swapDef) => ((d?.inputSchema as { required?: string[] })?.required ?? [])
  ok(
    'swap tool advertises required params',
    !!swapDef &&
      ['inputMint', 'outputMint', 'inputAssetSymbol', 'outputAssetSymbol', 'amount'].every((k) => req(swapDef).includes(k)),
    req(swapDef).join(','),
  )
  ok(
    'quote tool advertises required params',
    !!quoteDef && ['inputMint', 'outputMint', 'amount'].every((k) => req(quoteDef).includes(k)),
    req(quoteDef).join(','),
  )

  // Input parsing — nested {input:{...}} form, string→number coercion, swapMode pass-through
  const swap = readSdkSwapRequestInput({
    input: {
      inputMint: 'A',
      outputMint: 'B',
      inputAssetSymbol: 'SOL',
      outputAssetSymbol: 'USDC',
      amount: '0.5',
      slippageBps: '150',
      swapMode: 'in',
      note: 'rebalance',
      idempotencyKey: 'k1',
    },
  })
  ok(
    'swap input parsed (coercion + passthrough)',
    swap.inputMint === 'A' &&
      swap.outputAssetSymbol === 'USDC' &&
      swap.amount === '0.5' &&
      swap.slippageBps === 150 &&
      swap.swapMode === 'in' &&
      swap.idempotencyKey === 'k1',
  )

  // Invalid swapMode and non-numeric slippage are dropped (not passed through as garbage)
  const bad = readSdkSwapRequestInput({ inputMint: 'A', outputMint: 'B', slippageBps: 'abc', swapMode: 'sideways' })
  ok('invalid swapMode + non-numeric slippage dropped', bad.swapMode === undefined && bad.slippageBps === undefined)

  // Quote input — flat payload, numeric slippage
  const quote = readSdkQuoteRequestInput({ inputMint: 'A', outputMint: 'B', amount: '1', slippageBps: 100 })
  ok('quote input parsed (flat payload)', quote.inputMint === 'A' && quote.amount === '1' && quote.slippageBps === 100)

  console.log(`\n${failures === 0 ? '✅ C6 SDK tools: discovery + input parsing all pass' : `❌ ${failures} check(s) failed`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
