import {
  Client,
  createBackend,
  getInboxIdForIdentifier,
  type Identifier,
} from '@xmtp/node-sdk'
import { privateKeyToAccount } from 'viem/accounts'

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

function readFlag(args: string[], name: string): string | undefined {
  const exact = `--${name}`
  const prefixed = `--${name}=`
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (!value) {
      continue
    }
    if (value === exact) {
      return args[index + 1]
    }

    if (value.startsWith(prefixed)) {
      return value.slice(prefixed.length)
    }
  }

  return undefined
}

const env = readProcessEnv()
const args = process.argv.slice(2)
const envName = (env.XMTP_ENV?.trim() || 'dev') as 'local' | 'dev' | 'production'
const signerKey = env.XMTP_WALLET_KEY?.trim()
const targetAddress =
  readFlag(args, 'address')?.trim() ||
  env.XMTP_MANAGER_ADDRESS?.trim() ||
  (signerKey?.startsWith('0x') ? privateKeyToAccount(signerKey as `0x${string}`).address : undefined)

if (!targetAddress?.startsWith('0x')) {
  throw new Error(
    'Provide --address 0x... or set XMTP_MANAGER_ADDRESS. XMTP_WALLET_KEY can be used to resolve the current signer too.',
  )
}

const identifier: Identifier = {
  identifier: targetAddress.toLowerCase(),
  identifierKind: 0,
}

const canMessage = await Client.canMessage([identifier], envName)
const backend = await createBackend({ env: envName })
const inboxId = await getInboxIdForIdentifier(backend, identifier)

console.log(
  JSON.stringify(
    {
      ok: true,
      env: envName,
      address: targetAddress,
      canMessage: canMessage.get(identifier.identifier) ?? false,
      inboxId,
      signerAddress:
        signerKey?.startsWith('0x')
          ? privateKeyToAccount(signerKey as `0x${string}`).address
          : undefined,
      note:
        inboxId
          ? 'Use this inbox id in XMTP_MANAGER_INBOX_ID if you want stable direct targeting.'
          : 'No inbox id was found for this address on the configured XMTP environment.',
    },
    null,
    2,
  ),
)
