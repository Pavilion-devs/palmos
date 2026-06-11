import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import bs58 from 'bs58'
import { fetchDashboardApi } from '../useDashboardStore'
import { OperatorSessionContext } from './useOperatorSession'

// Operator session state + the Sign-In With Solana (SIWS) dance. Lives inside the
// wallet-adapter providers so signIn() can use the connected wallet to sign the
// server nonce. See docs/operator-auth-plan.md §5.
//
// status:
//   'loading'         — initial /api/auth/session check in flight
//   'unauthenticated' — no active operator session
//   'signing'         — SIWS nonce/verify round-trip in flight
//   'authenticated'   — operator session active
//   'error'           — last sign-in attempt failed (retryable)
export function OperatorSessionProvider({ children }) {
  const { publicKey, signMessage, disconnect } = useWallet()
  const [operator, setOperator] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const response = await fetchDashboardApi('/api/auth/session', {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null)
      if (response.ok && payload?.ok && payload.operator) {
        setOperator(payload.operator)
        setStatus('authenticated')
      } else {
        setOperator(null)
        setStatus('unauthenticated')
      }
    } catch {
      setOperator(null)
      setStatus('unauthenticated')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setError('This wallet cannot sign messages. Try another wallet.')
      setStatus('error')
      return
    }

    setStatus('signing')
    setError('')
    try {
      const address = publicKey.toBase58()

      const nonceResponse = await fetchDashboardApi(
        `/api/auth/nonce?address=${encodeURIComponent(address)}`,
        { cache: 'no-store' },
      )
      const nonce = await nonceResponse.json().catch(() => null)
      if (!nonceResponse.ok || !nonce?.message) {
        throw new Error(nonce?.message || 'Could not start sign-in.')
      }

      const signatureBytes = await signMessage(
        new TextEncoder().encode(nonce.message),
      )
      const signature = bs58.encode(signatureBytes)

      const verifyResponse = await fetchDashboardApi('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature }),
      })
      const verified = await verifyResponse.json().catch(() => null)
      if (!verifyResponse.ok || !verified?.ok || !verified.operator) {
        throw new Error(verified?.message || 'Sign-in verification failed.')
      }

      setOperator(verified.operator)
      setStatus('authenticated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
      setStatus('error')
    }
  }, [publicKey, signMessage])

  const signOut = useCallback(async () => {
    try {
      await fetchDashboardApi('/api/auth/logout', { method: 'POST' })
    } catch {
      // Best-effort; clear local state regardless.
    }
    try {
      await disconnect()
    } catch {
      // Wallet may already be disconnected.
    }
    setOperator(null)
    setStatus('unauthenticated')
    setError('')
  }, [disconnect])

  const value = { operator, status, error, signIn, signOut, refresh }
  return (
    <OperatorSessionContext.Provider value={value}>
      {children}
    </OperatorSessionContext.Provider>
  )
}
