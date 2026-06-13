/**
 * Verify C2 (OwsClient.signAndBroadcastSolanaTx) end-to-end with a REAL Byreal swap tx — offline.
 *
 * Flow (no funds, no broadcast):
 *   1. Create a throwaway OWS vault + wallet  -> ownerPubkey
 *   2. ByrealClient.buildSwapUnsigned({ ownerPubkey })  -> real unsigned v0 swap tx for that owner
 *   3. ows.signAndBroadcastSolanaTx({ skipBroadcast: true })  -> OWS signs it
 *   4. Assert the owner signature is attached and valid over the message (tweetnacl)
 *
 * This exercises the actual "Byreal proposes, OWS signs" seam, including whether the OWS vault
 * can sign Byreal's production v0 transactions (which may use Address Lookup Tables).
 *
 * Run from the worktree:  node --import tsx scripts/verify-c2-ows-byreal-sign.ts
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PublicKey, VersionedTransaction } from '@solana/web3.js'
import nacl from 'tweetnacl'
import { OwsClient } from '../src/integrations/ows/client.js'
import { createByrealClient } from '../src/integrations/byreal/client.js'

const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const PASSPHRASE = 'c2-verify-passphrase'

async function main() {
  let failures = 0
  const ok = (label: string, cond: boolean, extra = '') => {
    console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`)
    if (!cond) failures++
  }

  // 1. Throwaway OWS vault + wallet
  const home = mkdtempSync(join(tmpdir(), 'palmos-c2-'))
  const ows = new OwsClient({ enabled: true, homeDir: home, vaultPath: join(home, '.ows'), passphrase: PASSPHRASE })
  const binding = await ows.ensureWallet({ name: 'c2' })
  const owner = binding.solanaAddress
  if (!owner) throw new Error('OWS wallet has no Solana account')
  console.log(`OWS wallet: ${owner}\n`)

  // 2. Byreal builds a real unsigned swap tx FOR this OWS owner
  const byreal = createByrealClient()
  const built = await byreal.buildSwapUnsigned({
    inputMint: SOL,
    outputMint: USDC,
    amount: '0.01',
    slippageBps: 100,
    ownerPubkey: owner,
  })
  const lutCount =
    (VersionedTransaction.deserialize(new Uint8Array(Buffer.from(built.unsignedTransactions[0], 'base64')))
      .message as { addressTableLookups?: unknown[] }).addressTableLookups?.length ?? 0
  console.log(
    `Byreal built swap: 0.01 SOL -> ${built.quote.uiOutAmount} USDC (${built.quote.routerType}), ` +
      `${built.unsignedTransactions[0].length}b base64, address-lookup-tables: ${lutCount}\n`,
  )

  // 3. OWS signs it (no broadcast)
  const res = await ows.signAndBroadcastSolanaTx({
    wallet: 'c2',
    base64Tx: built.unsignedTransactions[0],
    skipBroadcast: true,
  })

  // 4. Inspect the signed result
  const signed = VersionedTransaction.deserialize(new Uint8Array(Buffer.from(res.signedBase64, 'base64')))
  const ownerKey = new PublicKey(owner)
  const ownerIndex = signed.message.staticAccountKeys.findIndex((k) => k.equals(ownerKey))
  const ownerSig = ownerIndex >= 0 ? signed.signatures[ownerIndex] : undefined
  const attached = !!ownerSig && ownerSig.some((b) => b !== 0)
  const valid =
    !!ownerSig && nacl.sign.detached.verify(signed.message.serialize(), ownerSig, ownerKey.toBytes())

  ok('owner is a required signer', ownerIndex >= 0 && ownerIndex < signed.message.header.numRequiredSignatures, `index ${ownerIndex}, ${signed.message.header.numRequiredSignatures} required`)
  ok('owner signature attached', attached)
  ok('owner signature valid over message', valid)

  console.log(`\n${failures === 0 ? '✅ C2 signAndBroadcastSolanaTx: OWS signed a real Byreal swap tx (broadcast-ready)' : `❌ ${failures} check(s) failed`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verify crashed:', e)
  process.exit(2)
})
