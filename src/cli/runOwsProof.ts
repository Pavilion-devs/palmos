import { FileOwsAccessRegistry } from '../store/OwsAccessRegistry.js'
import { OwsClient } from '../integrations/ows/client.js'

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

const env = readProcessEnv()
const baseDir =
  env.AGENT_SPEND_OS_BASE_DIR?.trim() ||
  `/tmp/palmos-ows-proof-${Date.now().toString(36)}`
const owsClient = OwsClient.fromEnv(baseDir, env)

if (!owsClient) {
  throw new Error('OWS is disabled. Remove OWS_ENABLED=0 or configure the OWS environment.')
}

const wallet = await owsClient.ensureWallet({
  name: 'ows-proof-agent',
})
const signature = owsClient.signMessage(
  wallet.wallet.id,
  'solana',
  'palmos ows solana proof',
)
const apiKey = owsClient.createApiKey({
  name: 'ows-proof-agent-key',
  walletIds: [wallet.wallet.id],
  policyIds: [],
})

await new FileOwsAccessRegistry(baseDir).put({
  agentId: 'ows-proof-agent',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  runtimeWalletId: 'ows-proof-runtime-wallet',
  owsWalletId: wallet.wallet.id,
  owsWalletName: wallet.wallet.name,
  vaultPath: owsClient.vaultPath,
  apiKeyId: apiKey.id,
  apiKeyName: apiKey.name,
  apiKeyToken: apiKey.token,
})

console.log(
  JSON.stringify(
    {
      ok: true,
      baseDir,
      homeDir: owsClient.homeDir,
      vaultPath: owsClient.vaultPath,
      wallet: {
        ...wallet,
        solanaAddress: owsClient.getSolanaAddress(wallet.wallet.id),
      },
      signature,
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
      },
    },
    null,
    2,
  ),
)
