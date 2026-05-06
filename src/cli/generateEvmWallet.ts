import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const privateKey = generatePrivateKey()
const account = privateKeyToAccount(privateKey)

console.log(
  JSON.stringify(
    {
      privateKey,
      address: account.address,
      env: {
        XMTP_WALLET_KEY: privateKey,
        XMTP_MANAGER_ADDRESS: account.address,
      },
      note:
        'Use this EVM key for XMTP test notifications. Do not reuse it for production funds.',
    },
    null,
    2,
  ),
)
