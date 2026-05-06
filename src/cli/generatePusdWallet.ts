import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

const keypair = Keypair.generate()
const secretKey = Array.from(keypair.secretKey)
const privateKeyBase58 = bs58.encode(keypair.secretKey)
const publicKey = keypair.publicKey.toBase58()

console.log(
  JSON.stringify(
    {
      publicKey,
      privateKeyBase58,
      secretKeyJson: secretKey,
      env: {
        PUSD_AGENT_WALLET: publicKey,
        PUSD_AGENT_PRIVATE_KEY: privateKeyBase58,
      },
      note:
        'For real PUSD settlement, fund this Solana wallet with SOL for fees and PUSD for payments. PUSD_AGENT_PRIVATE_KEY accepts this base58 value or the JSON secretKey array.',
    },
    null,
    2,
  ),
)
