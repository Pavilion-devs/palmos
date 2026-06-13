/**
 * Spike 0 — Can the OWS vault sign a Solana VersionedTransaction?
 *
 * WHY: Byreal Agent Skills (`--unsigned-tx`) returns base64 *VersionedTransactions*.
 * PalmOS custody is the OWS vault, whose signing primitive today is only ever fed a
 * *legacy* Transaction's unsigned hex (`transactionToUnsignedHex`,
 * src/integrations/ows/client.ts:123). The whole "Byreal proposes, OWS signs" path (B)
 * hinges on one unknown: does `signTransaction('solana', <versioned-tx hex>)` return a
 * signature valid over the *versioned message*?
 *
 * This answers it definitively and OFFLINE — no RPC, no funds, no broadcast.
 *   PASS  => path B works as-is. C2 = signAndBroadcastSolanaTx(base64Tx).
 *   FAIL  => use a fallback (raw signMessage, or a funded local-key DeFi sub-wallet).
 *
 * A LEGACY transaction is signed first as a CONTROL: it's the exact path that already
 * settles transfers in production, so if the control fails the verdict is "bad
 * harness/vault", not "versioned unsupported".
 *
 * Run from the worktree:
 *   node --import tsx scripts/spike0-ows-versioned-sign.ts
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import nacl from 'tweetnacl'
import { signTransaction } from '@open-wallet-standard/core'
import { OwsClient } from '../src/integrations/ows/client.js'

const PASSPHRASE = 'spike0-passphrase'
const WALLET = 'spike0'

type Outcome = { signed: boolean; valid: boolean; error?: string }

const sigBytes = (sig: string) =>
  new Uint8Array(Buffer.from(sig.replace(/^0x/, ''), 'hex'))

async function main() {
  // 1. Throwaway vault + wallet — createWallet() provisions a Solana account for free.
  const home = mkdtempSync(join(tmpdir(), 'palmos-spike0-'))
  const vaultPath = join(home, '.ows')
  const ows = new OwsClient({
    enabled: true,
    homeDir: home,
    vaultPath,
    passphrase: PASSPHRASE,
  })
  const binding = await ows.ensureWallet({ name: WALLET })
  const address = binding.solanaAddress
  if (!address) throw new Error('OWS wallet has no Solana account — cannot run spike.')
  const owner = new PublicKey(address)
  console.log(`OWS Solana wallet: ${address}`)
  console.log(`Vault: ${vaultPath}\n`)

  // Valid-format dummy blockhash (32-byte base58) — we never broadcast, so it need not be live.
  const blockhash = PublicKey.default.toBase58()
  const ix = SystemProgram.transfer({ fromPubkey: owner, toPubkey: owner, lamports: 1 })

  // ---- CONTROL: legacy Transaction (the known-good production path) ----
  let legacy: Outcome
  try {
    const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight: 1 })
    tx.add(ix)
    const hex = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('hex')
    const { signature } = signTransaction(WALLET, 'solana', hex, PASSPHRASE, 0, vaultPath)
    const valid = nacl.sign.detached.verify(
      new Uint8Array(tx.serializeMessage()),
      sigBytes(signature),
      owner.toBytes(),
    )
    legacy = { signed: true, valid }
  } catch (e) {
    legacy = { signed: false, valid: false, error: (e as Error).message }
  }

  // ---- SUBJECT: VersionedTransaction (exactly what Byreal hands back) ----
  let versioned: Outcome
  try {
    const v0 = new TransactionMessage({
      payerKey: owner,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message()
    const vtx = new VersionedTransaction(v0)
    const hex = Buffer.from(vtx.serialize()).toString('hex') // proposed C2 unsigned-hex form
    const { signature } = signTransaction(WALLET, 'solana', hex, PASSPHRASE, 0, vaultPath)
    const valid = nacl.sign.detached.verify(
      new Uint8Array(vtx.message.serialize()),
      sigBytes(signature),
      owner.toBytes(),
    )
    // Prove it also re-attaches cleanly the way C2 will.
    vtx.addSignature(owner, sigBytes(signature))
    versioned = { signed: true, valid }
  } catch (e) {
    versioned = { signed: false, valid: false, error: (e as Error).message }
  }

  console.log('=== Spike 0 results ===')
  console.log('legacy    (control):', legacy)
  console.log('versioned (Byreal) :', versioned)

  const pass = versioned.signed && versioned.valid
  console.log('\n=== VERDICT ===')
  if (pass) {
    console.log('✅ PASS — OWS signs VersionedTransactions. Path B works as-is.')
    console.log('   C2: deserialize base64 → hex → OWS sign → addSignature(owner) → broadcast.')
  } else if (!legacy.valid) {
    console.log('⚠️  INCONCLUSIVE — the legacy CONTROL also failed, so this is a harness/vault')
    console.log('   setup problem, not a versioned-tx verdict. Fix the control first, then re-run.')
  } else {
    console.log('❌ FAIL — vault works (legacy control passed) but cannot sign versioned-tx hex.')
    console.log('   Use a fallback:')
    console.log('   (1) ows.signMessage over vtx.message.serialize() — only if it signs raw bytes w/o a prefix;')
    console.log('   (2) funded local-key DeFi sub-wallet — sign versioned txns with a Keypair (custody traded')
    console.log('       only for the DeFi account, funded from the OWS wallet).')
  }
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error('Spike crashed:', e)
  process.exit(2)
})
