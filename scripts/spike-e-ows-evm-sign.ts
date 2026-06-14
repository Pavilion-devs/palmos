/**
 * Spike E — Can the OWS vault sign an EVM (Mantle) transaction usable by viem?
 *
 * WHY: the Mantle layer (ERC-8004 identity + on-chain decision log) wants the SAME OWS vault
 * that signs Main's Solana swaps to also sign Mantle txns — "one agent, one vault, two chains".
 * Every OWS wallet already derives an `eip155:` (secp256k1, m/44'/60'/0'/0/0) address, and the
 * core exposes `signHash(wallet, "evm", <32-byte hash>)`. The whole OWS->viem signer bridge
 * hinges on one unknown: does signing a transaction's keccak256 hash with OWS produce r/s/recid
 * that viem can recover back to the wallet's EVM address (and that an EVM node will accept)?
 *
 * This answers it definitively and OFFLINE — no RPC, no funds, no broadcast:
 *   PASS  => bridge works. MantleAccount.signTransaction = serialize -> keccak256 -> signHash
 *            -> {r,s,yParity} -> serializeTransaction(tx, sig). Use OWS-EVM for deploy/mint/record.
 *   FAIL  => fall back to a viem privateKeyToAccount recorder key (MANTLE_RECORDER_PRIVATE_KEY).
 *
 * It also prints the LIVE agent "Main" OWS EVM address so the operator can fund it from
 * https://faucet.sepolia.mantle.xyz (testnet MNT only) before we deploy/record.
 *
 * Run from the worktree:
 *   node --import tsx scripts/spike-e-ows-evm-sign.ts
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  keccak256,
  recoverAddress,
  recoverTransactionAddress,
  serializeTransaction,
  parseGwei,
  type TransactionSerializableEIP1559,
} from 'viem'
import { signHash } from '@open-wallet-standard/core'
import { OwsClient } from '../src/integrations/ows/client.js'
import { FileAgentRegistry } from '../src/store/AgentRegistry.js'

const PASSPHRASE = 'spike-e-passphrase'
const WALLET = 'spike-e'
const MANTLE_SEPOLIA_CHAIN_ID = 5003

// secp256k1 curve order — used to normalize to EIP-2 "low-s" if OWS returns a high-s signature.
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

const strip0x = (s: string) => (s.startsWith('0x') ? s.slice(2) : s)
const hexToBig = (hex: string) => BigInt('0x' + strip0x(hex))
const big32 = (n: bigint) => ('0x' + n.toString(16).padStart(64, '0')) as `0x${string}`

function splitOwsSignature(signatureHex: string): { r: `0x${string}`; s: bigint } {
  const raw = strip0x(signatureHex)
  if (raw.length < 128) {
    throw new Error(`OWS signHash returned ${raw.length / 2} bytes; expected >= 64 (r||s).`)
  }
  const r = ('0x' + raw.slice(0, 64)) as `0x${string}`
  const s = hexToBig(raw.slice(64, 128))
  return { r, s }
}

/**
 * Reconstruct the viem-compatible signature from OWS's (r, s, recoveryId), normalizing to
 * low-s (EIP-2) and flipping parity when we normalize — exactly what the production bridge does.
 */
function toViemSignature(signatureHex: string, recoveryId: number) {
  const { r, s } = splitOwsSignature(signatureHex)
  let normS = s
  let yParity = (recoveryId & 1) as 0 | 1
  if (s > SECP256K1_N / 2n) {
    normS = SECP256K1_N - s
    yParity = (yParity ^ 1) as 0 | 1
  }
  return { r, s: big32(normS), yParity }
}

async function recoverEvmAddress(): Promise<string> {
  const baseDir = process.env.PALMOS_BASE_DIR ?? '/tmp/palmos-live'
  try {
    const agents = new FileAgentRegistry(baseDir)
    const all = await agents.list()
    const a = all.find((x) => x.walletId) ?? all[0]
    if (!a) return `(no agent in ${baseDir})`
    const ows = OwsClient.fromEnv(baseDir, { ...process.env, OWS_ENABLED: '1' })
    if (!ows) return '(OWS disabled)'
    const walletName = a.owsWalletName ?? a.owsWalletId ?? a.agentId
    const wallet = ows.getWallet(walletName)
    const evm = wallet.accounts.find((acc) => acc.chainId.startsWith('eip155:'))?.address
    return `${evm ?? '(no eip155 account)'}   [agent=${a.displayName ?? a.agentId}, wallet=${walletName}]`
  } catch (e) {
    return `(could not read live vault: ${(e as Error).message})`
  }
}

async function main() {
  // 1. Throwaway vault + wallet — createWallet() provisions an EVM (secp256k1) account for free.
  const home = mkdtempSync(join(tmpdir(), 'palmos-spike-e-'))
  const vaultPath = join(home, '.ows')
  const ows = new OwsClient({ enabled: true, homeDir: home, vaultPath, passphrase: PASSPHRASE })
  const binding = await ows.ensureWallet({ name: WALLET })
  const evmAddress = binding.evmAddress
  if (!evmAddress) throw new Error('OWS wallet has no EVM (eip155) account — cannot run spike.')
  console.log(`Throwaway OWS EVM wallet: ${evmAddress}`)
  console.log(`Vault: ${vaultPath}\n`)

  // 2. A representative Mantle Sepolia EIP-1559 transaction (contract call shape). Never broadcast.
  const tx: TransactionSerializableEIP1559 = {
    chainId: MANTLE_SEPOLIA_CHAIN_ID,
    type: 'eip1559',
    nonce: 0,
    to: '0x000000000000000000000000000000000000dEaD',
    value: 0n,
    data: '0xdeadbeef',
    gas: 100_000n,
    maxFeePerGas: parseGwei('0.05'),
    maxPriorityFeePerGas: parseGwei('0.01'),
  }

  // 3. The bridge: serialize unsigned -> keccak256 -> OWS signHash -> reconstruct -> serialize signed.
  const unsignedSerialized = serializeTransaction(tx)
  const signingHash = keccak256(unsignedSerialized)
  const { signature, recoveryId } = signHash(
    WALLET,
    'evm',
    strip0x(signingHash),
    PASSPHRASE,
    0,
    vaultPath,
  )
  console.log(`signHash recoveryId: ${recoveryId}`)
  const sig = toViemSignature(signature, recoveryId ?? 0)

  // 4a. Recover from the raw hash (curve-level correctness).
  let hashRecovered = ''
  try {
    hashRecovered = await recoverAddress({ hash: signingHash, signature: sig })
  } catch (e) {
    hashRecovered = `(recover failed: ${(e as Error).message})`
  }
  const hashOk = hashRecovered.toLowerCase() === evmAddress.toLowerCase()

  // 4b. Serialize the SIGNED tx and recover the sender (what a node will see on broadcast).
  let txRecovered = ''
  let signedSerialized = ''
  try {
    const signed = serializeTransaction(tx, sig)
    signedSerialized = signed
    txRecovered = await recoverTransactionAddress({
      serializedTransaction: signed as `0x02${string}`,
    })
  } catch (e) {
    txRecovered = `(serialize/recover failed: ${(e as Error).message})`
  }
  const txOk = txRecovered.toLowerCase() === evmAddress.toLowerCase()

  console.log('\n=== Spike E results ===')
  console.log('expected EVM address :', evmAddress)
  console.log('hash recovery        :', hashRecovered, hashOk ? '✅' : '❌')
  console.log('signed-tx recovery   :', txRecovered, txOk ? '✅' : '❌')
  console.log('signed tx (first 20B):', signedSerialized.slice(0, 42))

  const pass = hashOk && txOk
  console.log('\n=== VERDICT ===')
  if (pass) {
    console.log('✅ PASS — OWS signs EVM tx hashes; viem recovers the vault address.')
    console.log('   Bridge: serialize -> keccak256 -> signHash(evm) -> {r,s,yParity} -> serializeTransaction.')
    console.log('   => Use the OWS-EVM account as deployer + identity owner + decision-log signer.')
  } else {
    console.log('❌ FAIL — OWS-EVM bridge did not recover cleanly.')
    console.log('   => Fall back to a viem privateKeyToAccount recorder (MANTLE_RECORDER_PRIVATE_KEY).')
  }

  console.log('\n=== LIVE Main OWS EVM address (FUND THIS with test MNT) ===')
  console.log(await recoverEvmAddress())
  console.log('Faucet: https://faucet.sepolia.mantle.xyz   (Mantle Sepolia, chainId 5003, testnet only)')

  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error('Spike E crashed:', e)
  process.exit(2)
})
