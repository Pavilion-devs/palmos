import assert from 'node:assert/strict'
import test from 'node:test'
import { Keypair } from '@solana/web3.js'
import {
  toLamports,
  toRawUmbraAmount,
} from '../src/integrations/umbra/amount.js'
import {
  readUmbraRuntimeConfig,
} from '../src/integrations/umbra/readiness.js'

test('converts Umbra decimal amounts to raw token units', () => {
  assert.equal(toRawUmbraAmount('0.001', 9), 1_000_000n)
  assert.equal(toRawUmbraAmount('12.345678', 6), 12_345_678n)
  assert.equal(toLamports('1.25'), 1_250_000_000n)

  assert.throws(() => toRawUmbraAmount('not-a-number', 9), /Invalid Umbra amount/)
})

test('validates Umbra runtime config without network access', () => {
  assert.throws(() => readUmbraRuntimeConfig({}), /UMBRA_SECRET_KEY_BASE64/)

  const secretKeyBase64 = Buffer.from(Keypair.generate().secretKey).toString(
    'base64',
  )
  const config = readUmbraRuntimeConfig({
    UMBRA_SECRET_KEY_BASE64: secretKeyBase64,
    UMBRA_NETWORK: 'devnet',
  })

  assert.equal(config.secretKeyBase64, secretKeyBase64)
  assert.equal(config.network, 'devnet')
  assert.equal(config.rpcUrl, 'https://api.devnet.solana.com')
  assert.equal(
    config.indexerApiEndpoint,
    'https://utxo-indexer.api-devnet.umbraprivacy.com',
  )
  assert.equal(
    config.relayerApiEndpoint,
    'https://relayer.api-devnet.umbraprivacy.com',
  )
})
