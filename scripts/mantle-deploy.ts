/**
 * Deploy the PalmOS Mantle contracts (ERC-8004 IdentityRegistry + AgentActionLog) to Mantle
 * Sepolia, signed by agent Main's OWS EVM account (the same vault that signs its Solana swaps).
 * Writes the addresses to <baseDir>/mantle/deployment.json so the mint/runtime pick them up
 * automatically. Idempotent-ish: re-running redeploys fresh contracts (cheap on testnet).
 *
 * Prereq: fund the deployer with test MNT (https://faucet.sepolia.mantle.xyz).
 * Run:    node --import tsx scripts/mantle-deploy.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { formatEther } from 'viem'
import { FileAgentRegistry } from '../src/store/AgentRegistry.js'
import { OwsClient } from '../src/integrations/ows/client.js'
import {
  MantleClient,
  resolveMantleAccount,
} from '../src/integrations/mantle/client.js'
import { loadMantleConfig, mergeMantleDeployment } from '../src/integrations/mantle/deploymentStore.js'
import { mantleAddressUrl, mantleTxUrl } from '../src/integrations/mantle/chain.js'

const baseDir = process.env.PALMOS_BASE_DIR ?? '/tmp/palmos-live'
const outDir = fileURLToPath(new URL('../contracts/out/', import.meta.url))

function loadArtifact(name: string): { abi: readonly unknown[]; bytecode: `0x${string}` } {
  const raw = JSON.parse(readFileSync(`${outDir}${name}.json`, 'utf8'))
  return { abi: raw.abi, bytecode: raw.bytecode }
}

const agents = new FileAgentRegistry(baseDir)
const all = await agents.list()
const agent = all.find((x) => x.walletId) ?? all[0]
if (!agent) throw new Error(`No agent in ${baseDir}`)
const ows = OwsClient.fromEnv(baseDir, { ...process.env, OWS_ENABLED: '1' })
if (!ows) throw new Error('OWS is disabled')
const walletName = agent.owsWalletName ?? agent.owsWalletId ?? agent.agentId

const account = resolveMantleAccount({ ows, walletName, env: process.env })
if (!account) throw new Error('No Mantle signer (no OWS EVM account, no MANTLE_RECORDER_PRIVATE_KEY)')
const config = await loadMantleConfig(baseDir, process.env)
const client = new MantleClient(config, account)

console.log(`Deployer (OWS EVM): ${account.address}`)
console.log(`RPC: ${config.rpcUrl}`)
const balance = await client.getBalance()
console.log(`Balance: ${formatEther(balance)} MNT`)
if (balance === 0n) {
  console.error(`\n❌ Deployer has 0 MNT. Fund it, then re-run:`)
  console.error(`   ${account.address}`)
  console.error(`   Faucet: https://faucet.sepolia.mantle.xyz`)
  process.exit(1)
}

console.log('\nDeploying IdentityRegistry...')
const identity = await client.deploy(loadArtifact('IdentityRegistry'))
console.log(`  IdentityRegistry: ${identity.address}`)
console.log(`  tx: ${mantleTxUrl(identity.txHash, config.explorer)}`)

console.log('\nDeploying AgentActionLog...')
const log = await client.deploy(loadArtifact('AgentActionLog'))
console.log(`  AgentActionLog: ${log.address}`)
console.log(`  tx: ${mantleTxUrl(log.txHash, config.explorer)}`)

await mergeMantleDeployment(baseDir, {
  chainId: 5003,
  explorer: config.explorer,
  rpcUrl: config.rpcUrl,
  identityRegistry: identity.address,
  actionLog: log.address,
  deployer: account.address,
  deployTx: { identityRegistry: identity.txHash, actionLog: log.txHash },
})

console.log('\n✅ Deployed. Saved to <baseDir>/mantle/deployment.json')
console.log(`   IdentityRegistry: ${mantleAddressUrl(identity.address, config.explorer)}`)
console.log(`   AgentActionLog:   ${mantleAddressUrl(log.address, config.explorer)}`)
console.log('\nNext: node --import tsx scripts/mantle-mint-identity.ts')
console.log('Verify: node --import tsx scripts/mantle-verify.ts')
