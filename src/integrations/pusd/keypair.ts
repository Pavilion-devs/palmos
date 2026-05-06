import { readFile } from 'fs/promises'
import bs58 from 'bs58'
import { Keypair } from '@solana/web3.js'

export type ReadSolanaKeypairInput = {
  privateKey?: string
  keypairPath?: string
}

function keypairFromJsonArray(value: string): Keypair | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)
    ) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]))
    }
  } catch {
    return undefined
  }

  return undefined
}

export function readSolanaKeypairFromPrivateKey(value: string): Keypair {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error('Solana private key cannot be empty.')
  }

  const jsonKeypair = keypairFromJsonArray(normalized)
  if (jsonKeypair) {
    return jsonKeypair
  }

  return Keypair.fromSecretKey(bs58.decode(normalized))
}

export async function readSolanaKeypair(
  input: ReadSolanaKeypairInput,
): Promise<Keypair | undefined> {
  if (input.privateKey?.trim()) {
    return readSolanaKeypairFromPrivateKey(input.privateKey)
  }

  if (!input.keypairPath?.trim()) {
    return undefined
  }

  const fileContents = await readFile(input.keypairPath, 'utf8')
  return readSolanaKeypairFromPrivateKey(fileContents)
}

export async function readSolanaKeypairFromEnv(
  env: Record<string, string | undefined> = process.env,
): Promise<Keypair | undefined> {
  return readSolanaKeypair({
    privateKey: env.PUSD_AGENT_PRIVATE_KEY,
    keypairPath: env.PUSD_AGENT_KEYPAIR_PATH,
  })
}
