import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatPusdBaseUnits,
  parsePusdAmountToBaseUnits,
} from '../src/integrations/pusd/amount.js'
import { PalmosClient } from '../src/integrations/pusd/client.js'
import { PALMOS_PAYMENT_RAIL } from '../src/integrations/pusd/constants.js'
import { readSolanaKeypairFromEnv } from '../src/integrations/pusd/keypair.js'
import {
  assertPusdPaymentInstructionMatchesPolicy,
  createPusdPaymentRequest,
  toPusdPaymentRequiredResponse,
  validatePusdPaymentInstruction,
} from '../src/integrations/pusd/paymentInstructions.js'
import {
  formatPusdReadinessFailure,
  type PusdPaymentReadinessReport,
} from '../src/integrations/pusd/readiness.js'
import type { PalmosPaidServiceDefinition } from '../src/integrations/pusd/serviceCatalog.js'
import { Keypair } from '@solana/web3.js'

const PUSD_MINT = 'CZzgUBvxaMLwMhVSLgqJn3npmxoTo6nzMNQPAnwtHF3s'

test('parses and formats PUSD amounts at six decimals', () => {
  assert.equal(parsePusdAmountToBaseUnits('0.000001'), 1n)
  assert.equal(parsePusdAmountToBaseUnits('1'), 1_000_000n)
  assert.equal(parsePusdAmountToBaseUnits('12.340005'), 12_340_005n)
  assert.equal(formatPusdBaseUnits(12_340_005n), '12.340005')
  assert.equal(formatPusdBaseUnits(12_000_000n), '12')

  assert.throws(
    () => parsePusdAmountToBaseUnits('0.0000001'),
    /Invalid PUSD amount/,
  )
})

test('creates deterministic PUSD payment instructions and validates policy binding', () => {
  const request = createPusdPaymentRequest({
    amount: '0.01',
    recipient: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
    description: 'Test payment',
    serviceId: 'local.pusd.spot_price',
    vendorId: 'local_pusd_demo',
    ttlSeconds: 60,
    now: () => new Date('2026-05-09T12:00:00.000Z'),
    createId: () => 'pusd_pay_req_test',
    env: {
      PUSD_SOLANA_NETWORK: 'mainnet-beta',
      PUSD_MINT,
    },
  })
  const payment = toPusdPaymentRequiredResponse(request)

  assert.equal(payment.amount, '0.01')
  assert.equal(payment.reference, 'pusd_pay_req_test')
  assert.equal(payment.expiresAt, '2026-05-09T12:01:00.000Z')
  assert.equal(payment.mint, PUSD_MINT)
  assert.deepEqual(
    validatePusdPaymentInstruction(payment, {
      amount: '0.010000',
      recipient: request.recipient,
      mint: PUSD_MINT,
      network: 'solana-mainnet',
    }),
    [],
  )
  assert.throws(
    () =>
      assertPusdPaymentInstructionMatchesPolicy(payment, {
        amount: '0.02',
        recipient: request.recipient,
      }),
    /amount_mismatch/,
  )
})

test('formats readiness failures with concrete failing checks', () => {
  const report: PusdPaymentReadinessReport = {
    ok: false,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    payer: 'payer',
    recipient: 'recipient',
    mint: PUSD_MINT,
    amount: '0.01',
    amountBaseUnits: '10000',
    tokenProgramId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    payerTokenAccount: 'payerAta',
    recipientTokenAccount: 'recipientAta',
    checks: [
      {
        checkId: 'pusd.payer.sol_balance',
        status: 'failed',
        summary: 'Payer does not have enough SOL for transaction fees.',
      },
      {
        checkId: 'pusd.recipient.ata_exists',
        status: 'warning',
        summary: 'Recipient ATA will be created.',
      },
    ],
  }

  assert.equal(
    formatPusdReadinessFailure(report),
    'pusd.payer.sol_balance: Payer does not have enough SOL for transaction fees.',
  )
})

test('PalmosClient obeys explicit local and real Solana settlement modes', async () => {
  const request = createPusdPaymentRequest({
    amount: '0.01',
    recipient: '4tC7nLrTUz5nYhhWMspiXAuQcGpBVyRzuMNxR19Xaczy',
    serviceId: 'local.pusd.spot_price',
    vendorId: 'local_pusd_demo',
    now: () => new Date('2026-05-09T12:00:00.000Z'),
    createId: () => 'pusd_pay_req_mode_test',
    env: {
      PUSD_SOLANA_NETWORK: 'mainnet-beta',
      PUSD_MINT,
    },
  })
  const payment = toPusdPaymentRequiredResponse(request)
  const service: PalmosPaidServiceDefinition<Record<string, unknown>> = {
    serviceId: 'local.pusd.spot_price',
    label: 'Spot price',
    vendorId: 'local_pusd_demo',
    chainId: 'solana-mainnet',
    assetSymbol: 'PUSD',
    expectedAmount: '0.01',
    paymentRail: PALMOS_PAYMENT_RAIL,
    buildRequest: () => ({
      url: 'http://127.0.0.1:4021/spot-price',
      init: { method: 'POST' },
      requestSummary: {},
    }),
  }

  const localCalls: RequestInit[] = []
  const localClient = new PalmosClient(
    {
      allowLocalDemoPayments: true,
      keypair: {
        privateKey: 'not-a-solana-private-key',
      },
    },
    async (_url, init) => {
      localCalls.push(init ?? {})
      if (localCalls.length === 1) {
        return new Response(JSON.stringify(payment), {
          status: 402,
          headers: { 'content-type': 'application/json' },
        })
      }

      const headers = new Headers(init?.headers)
      assert.equal(headers.get('x-palmos-demo-payment'), '1')
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  )

  const localResult = await localClient.execute(
    service,
    {},
    { settlementMode: 'local-demo' },
  )
  assert.equal(localResult.status, 200)
  assert.equal(localCalls.length, 2)

  const realClient = new PalmosClient(
    {
      allowLocalDemoPayments: true,
    },
    async () =>
      new Response(JSON.stringify(payment), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      }),
  )

  await assert.rejects(
    () => realClient.execute(service, {}, { settlementMode: 'real-solana' }),
    /Real Solana PUSD settlement requires/,
  )
})

test('Solana keypair env reader accepts OWS wallet fallback', async () => {
  const keypair = Keypair.generate()
  const loaded = await readSolanaKeypairFromEnv({
    OWS_WALLET_PRIVATE_KEY: JSON.stringify([...keypair.secretKey]),
  })

  assert.equal(loaded?.publicKey.toBase58(), keypair.publicKey.toBase58())
})
