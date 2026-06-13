import assert from 'node:assert/strict'
import test from 'node:test'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  resolveSplAssetSettlement,
  tokenAmountToBaseUnits,
} from '../src/integrations/pusd/splAssets.js'
import {
  PUSD_TOKEN_PROGRAM_ID,
  PUSD_SOLANA_MINT,
} from '../src/integrations/pusd/constants.js'

test('resolveSplAssetSettlement maps USDC to the classic Token program per cluster', () => {
  const devnet = resolveSplAssetSettlement('USDC', { PUSD_SOLANA_NETWORK: 'devnet' })
  assert.equal(devnet?.mint, '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
  assert.equal(devnet?.decimals, 6)
  assert.equal(devnet?.tokenProgramId, TOKEN_PROGRAM_ID.toBase58())

  const mainnet = resolveSplAssetSettlement('usdc', { PUSD_SOLANA_NETWORK: 'mainnet' })
  assert.equal(mainnet?.mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
  assert.equal(mainnet?.symbol, 'USDC')
})

test('resolveSplAssetSettlement maps PUSD to the Token-2022 program', () => {
  const pusd = resolveSplAssetSettlement('PUSD', {})
  assert.equal(pusd?.mint, PUSD_SOLANA_MINT)
  assert.equal(pusd?.decimals, 6)
  assert.equal(pusd?.tokenProgramId, PUSD_TOKEN_PROGRAM_ID)
})

test('resolveSplAssetSettlement honors USDC_MINT override and rejects unknown assets', () => {
  const overridden = resolveSplAssetSettlement('USDC', {
    PUSD_SOLANA_NETWORK: 'devnet',
    USDC_MINT: 'TestMintAddress11111111111111111111111111111',
  })
  assert.equal(overridden?.mint, 'TestMintAddress11111111111111111111111111111')

  // SOL is handled natively elsewhere, not as an SPL asset.
  assert.equal(resolveSplAssetSettlement('SOL', {}), undefined)
  assert.equal(resolveSplAssetSettlement('WIF', {}), undefined)
  // local cluster has no canonical USDC mint
  assert.equal(
    resolveSplAssetSettlement('USDC', { PUSD_SOLANA_NETWORK: 'local' }),
    undefined,
  )
})

test('tokenAmountToBaseUnits converts decimals without float drift', () => {
  assert.equal(tokenAmountToBaseUnits('1', 6), 1_000_000n)
  assert.equal(tokenAmountToBaseUnits('0.1', 6), 100_000n)
  assert.equal(tokenAmountToBaseUnits('0.000001', 6), 1n)
  assert.equal(tokenAmountToBaseUnits('1.5', 9), 1_500_000_000n)
  // extra fractional precision is truncated, not rounded
  assert.equal(tokenAmountToBaseUnits('1.1234567', 6), 1_123_456n)
  assert.equal(tokenAmountToBaseUnits('0', 6), 0n)
})
