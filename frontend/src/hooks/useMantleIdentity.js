import { useEffect, useState } from 'react'
import { fetchDashboardApi } from '../useDashboardStore'

const POLL_INTERVAL_MS = Number(
  import.meta.env.VITE_DASHBOARD_POLL_INTERVAL_MS || '3000',
)

const INITIAL_STATE = {
  // 'idle' — no fetch yet; 'ready' — loaded (mantle may be null if not deployed); 'unavailable' — failed
  status: 'idle',
  mantle: null,
  error: null,
}

/**
 * Polls `/api/dashboard/mantle` for the agent's ERC-8004 identity on Mantle (deployed contracts +
 * minted agent card). Self-contained, mirroring useDashboardTransactions: the identity card renders
 * only once contracts are deployed + minted, and quietly stays hidden otherwise.
 */
export default function useMantleIdentity() {
  const [state, setState] = useState(INITIAL_STATE)

  useEffect(() => {
    let cancelled = false
    let inFlight = false

    async function load() {
      if (cancelled || inFlight) {
        return
      }
      inFlight = true

      try {
        const response = await fetchDashboardApi('/api/dashboard/mantle', {
          cache: 'no-store',
        })
        const payload = await response.json().catch(() => null)
        if (cancelled) {
          return
        }
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message || payload?.error || `Unable to load Mantle identity (${response.status})`,
          )
        }
        setState({ status: 'ready', mantle: payload.mantle ?? null, error: null })
      } catch (error) {
        if (cancelled) {
          return
        }
        setState((previous) => ({
          status: 'unavailable',
          mantle: previous.mantle,
          error: error instanceof Error ? error.message : 'Unable to load Mantle identity',
        }))
      } finally {
        inFlight = false
      }
    }

    void load()
    const intervalId = setInterval(() => {
      void load()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [])

  return state
}
