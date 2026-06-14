/**
 * OWS → viem account bridge. Wraps an OWS vault wallet's EVM key as a viem `LocalAccount` whose
 * signing delegates to the vault (the key never leaves custody). This lets the SAME OWS vault that
 * signs Main's Solana swaps also deploy/mint/record on Mantle.
 *
 * The mechanism (proven in scripts/spike-e-ows-evm-sign.ts):
 *   serialize unsigned tx -> keccak256 -> OWS signEvmHash -> reconstruct {r,s,yParity} -> serialize.
 * `s` is normalized to EIP-2 low-s (flipping parity when normalized) so any node accepts it.
 */
import {
  hashMessage,
  hashTypedData,
  keccak256,
  serializeSignature,
  serializeTransaction,
  type Hex,
} from 'viem'
import { toAccount } from 'viem/accounts'
import type { OwsClient } from '../ows/client.js'

const SECP256K1_N =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

function reconstructSignature(
  ows: Pick<OwsClient, 'signEvmHash'>,
  walletName: string,
  hash: Hex,
): { r: Hex; s: Hex; yParity: 0 | 1 } {
  const { signature, recoveryId } = ows.signEvmHash(walletName, hash)
  const raw = signature.replace(/^0x/, '')
  if (raw.length < 128) {
    throw new Error(`OWS signEvmHash returned ${raw.length / 2} bytes; expected >= 64 (r||s).`)
  }
  const r = (`0x${raw.slice(0, 64)}`) as Hex
  let s = BigInt(`0x${raw.slice(64, 128)}`)
  let yParity = (recoveryId & 1) as 0 | 1
  if (s > SECP256K1_N / 2n) {
    s = SECP256K1_N - s
    yParity = (yParity ^ 1) as 0 | 1
  }
  return { r, s: (`0x${s.toString(16).padStart(64, '0')}`) as Hex, yParity }
}

/**
 * Build a viem account backed by an OWS vault wallet's EVM key.
 * @param ows         OWS client (or anything exposing getEvmAddress + signEvmHash)
 * @param walletName  the agent's OWS wallet name/id
 */
export function createOwsEvmAccount(
  ows: Pick<OwsClient, 'getEvmAddress' | 'signEvmHash'>,
  walletName: string,
) {
  const address = ows.getEvmAddress(walletName)
  if (!address) {
    throw new Error(`OWS wallet ${walletName} has no EVM (eip155) account.`)
  }

  return toAccount({
    address: address as Hex,
    async signMessage({ message }) {
      return serializeSignature(reconstructSignature(ows, walletName, hashMessage(message)))
    },
    async signTransaction(transaction) {
      // Mantle Sepolia uses standard EIP-1559 serialization, so viem's default serializer is correct.
      const unsigned = serializeTransaction(transaction)
      const signature = reconstructSignature(ows, walletName, keccak256(unsigned))
      return serializeTransaction(transaction, signature)
    },
    async signTypedData(typedData) {
      return serializeSignature(
        reconstructSignature(ows, walletName, hashTypedData(typedData as never)),
      )
    },
  })
}

export type OwsEvmAccount = ReturnType<typeof createOwsEvmAccount>
