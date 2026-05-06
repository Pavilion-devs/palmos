import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const privateKey = generatePrivateKey()
const account = privateKeyToAccount(privateKey)

console.log(
  JSON.stringify(
    {
      privateKey,
      address: account.address,
      note: 'Fund this buyer wallet with Base Sepolia testnet USDC before running the live x402 agent flow.',
    },
    null,
    2,
  ),
)
