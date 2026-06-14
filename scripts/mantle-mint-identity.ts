/**
 * Mint agent Main's ERC-8004 identity NFT on the deployed IdentityRegistry. Idempotent: if Main's
 * OWS EVM address already owns an identity, it reports the existing token id instead of minting.
 * The tokenURI is the agent card (capabilities + endpoints + Solana payment address) as an on-chain
 * base64 data: URI. Writes the minted identity into <baseDir>/mantle/deployment.json for the dashboard.
 *
 * Prereq: scripts/mantle-deploy.ts has run (IdentityRegistry address in the artifact).
 * Run:    node --import tsx scripts/mantle-mint-identity.ts
 */
import { FileAgentRegistry } from '../src/store/AgentRegistry.js'
import { OwsClient } from '../src/integrations/ows/client.js'
import { MantleClient, resolveMantleAccount } from '../src/integrations/mantle/client.js'
import {
  loadMantleConfig,
  mergeMantleDeployment,
} from '../src/integrations/mantle/deploymentStore.js'
import { agentCardToDataUri, buildAgentCard } from '../src/integrations/mantle/agentCard.js'
import { mantleTokenInstanceUrl, mantleTxUrl } from '../src/integrations/mantle/chain.js'

const baseDir = process.env.PALMOS_BASE_DIR ?? '/tmp/palmos-live'

const agents = new FileAgentRegistry(baseDir)
const all = await agents.list()
const agent = all.find((x) => x.walletId) ?? all[0]
if (!agent) throw new Error(`No agent in ${baseDir}`)
const ows = OwsClient.fromEnv(baseDir, { ...process.env, OWS_ENABLED: '1' })
if (!ows) throw new Error('OWS is disabled')
const walletName = agent.owsWalletName ?? agent.owsWalletId ?? agent.agentId

const account = resolveMantleAccount({ ows, walletName, env: process.env })
if (!account) throw new Error('No Mantle signer resolved')
const config = await loadMantleConfig(baseDir, process.env)
if (!config.identityRegistryAddress) {
  throw new Error('No IdentityRegistry address. Run scripts/mantle-deploy.ts first.')
}
const client = new MantleClient(config, account)

const solanaAddress = ows.getSolanaAddress(walletName)
if (!solanaAddress) throw new Error(`OWS wallet ${walletName} has no Solana account.`)

const card = buildAgentCard({
  name: agent.displayName ?? 'Main',
  solanaPaymentAddress: solanaAddress,
  evmIdentityAddress: account.address,
  identityRegistry: config.identityRegistryAddress,
  chainId: 5003,
})
const cardUri = agentCardToDataUri(card)

console.log(`Identity owner (OWS EVM): ${account.address}`)
console.log(`Agent payment address (Solana): ${solanaAddress}`)
console.log(`Registry: ${config.identityRegistryAddress}`)
console.log(`Agent card: ${JSON.stringify(card, null, 2)}`)

const balance = await client.getBalance()
if (balance === 0n) {
  console.error(`\n❌ ${account.address} has 0 MNT — fund it before minting (faucet.sepolia.mantle.xyz).`)
  process.exit(1)
}

const result = await client.registerIdentity(cardUri)
const tokenUrl = mantleTokenInstanceUrl(config.identityRegistryAddress, result.agentId, config.explorer)

if (result.alreadyRegistered) {
  console.log(`\nℹ️  Already registered — agentId ${result.agentId}`)
} else {
  console.log(`\n✅ Minted identity NFT — agentId ${result.agentId}`)
  console.log(`   mint tx: ${mantleTxUrl(result.txHash!, config.explorer)}`)
}
console.log(`   token: ${tokenUrl}`)

await mergeMantleDeployment(baseDir, {
  agent: {
    agentId: result.agentId.toString(),
    owner: account.address,
    solanaPaymentAddress: solanaAddress,
    card,
    cardUri,
    tokenUrl,
    mintTx: result.txHash,
    mintTxUrl: result.txHash ? mantleTxUrl(result.txHash, config.explorer) : undefined,
  },
})
console.log('\nSaved minted identity to <baseDir>/mantle/deployment.json')
