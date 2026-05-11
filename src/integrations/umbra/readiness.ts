import { Keypair } from '@solana/web3.js'
import {
  defaultUmbraIndexerApiEndpoint,
  defaultUmbraRelayerApiEndpoint,
  type UmbraNetwork,
} from './constants.js'

export type UmbraRuntimeConfig = {
  secretKeyBase64: string
  network: UmbraNetwork
  rpcUrl: string
  rpcSubscriptionsUrl: string
  indexerApiEndpoint?: string
  relayerApiEndpoint?: string
}

export function readUmbraRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): UmbraRuntimeConfig {
  const secretKeyBase64 = env.UMBRA_SECRET_KEY_BASE64?.trim()
  if (!secretKeyBase64) {
    throw new Error('UMBRA_SECRET_KEY_BASE64 is required for the Umbra proof.')
  }

  const network = readUmbraNetwork(env.UMBRA_NETWORK)
  return {
    secretKeyBase64,
    network,
    rpcUrl:
      env.SOLANA_RPC_URL?.trim() ||
      env.UMBRA_SOLANA_RPC_URL?.trim() ||
      defaultRpcUrl(network),
    rpcSubscriptionsUrl:
      env.SOLANA_WS_URL?.trim() ||
      env.UMBRA_SOLANA_WS_URL?.trim() ||
      defaultWsUrl(network),
    indexerApiEndpoint:
      env.UMBRA_INDEXER_API_URL?.trim() ||
      defaultUmbraIndexerApiEndpoint(network),
    relayerApiEndpoint:
      env.UMBRA_RELAYER_API_URL?.trim() ||
      defaultUmbraRelayerApiEndpoint(network),
  }
}

export function readUmbraKeypair(secretKeyBase64: string): Keypair {
  return Keypair.fromSecretKey(
    new Uint8Array(Buffer.from(secretKeyBase64, 'base64')),
  )
}

function readUmbraNetwork(value: string | undefined): UmbraNetwork {
  switch (value?.trim()) {
    case 'mainnet':
      return 'mainnet'
    case 'localnet':
      return 'localnet'
    case 'devnet':
    case undefined:
    case '':
      return 'devnet'
    default:
      throw new Error(`Unsupported UMBRA_NETWORK: ${value}`)
  }
}

function defaultRpcUrl(network: UmbraNetwork): string {
  switch (network) {
    case 'mainnet':
      return 'https://api.mainnet-beta.solana.com'
    case 'localnet':
      return 'http://127.0.0.1:8899'
    case 'devnet':
      return 'https://api.devnet.solana.com'
  }
}

function defaultWsUrl(network: UmbraNetwork): string {
  switch (network) {
    case 'mainnet':
      return 'wss://api.mainnet-beta.solana.com'
    case 'localnet':
      return 'ws://127.0.0.1:8900'
    case 'devnet':
      return 'wss://api.devnet.solana.com'
  }
}
