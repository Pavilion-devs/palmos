import { useEffect, useState } from 'react'
import { fetchDashboardApi } from '../useDashboardStore'

const POLL_INTERVAL_MS = Number(
  import.meta.env.VITE_DASHBOARD_POLL_INTERVAL_MS || '3000',
)

const INITIAL_STATE = {
  // 'idle'        — no successful fetch yet (callers should use the snapshot)
  // 'ready'       — last fetch succeeded (callers should prefer this source)
  // 'unavailable' — last fetch failed (callers should fall back to snapshot)
  status: 'idle',
  transactions: [],
  summary: null,
  error: null,
}

/**
 * Polls the unified `/api/dashboard/transactions` projection. Intentionally
 * self-contained so the Transactions view can prefer the backend projection
 * while gracefully falling back to snapshot-derived events when the endpoint is
 * unavailable (older backend, access denied, transient failure).
 */
export default function useDashboardTransactions(limit = 100, agentId) {
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
        const agentQuery = agentId
          ? `&agentId=${encodeURIComponent(agentId)}`
          : ''
        const response = await fetchDashboardApi(
          `/api/dashboard/transactions?limit=${encodeURIComponent(limit)}${agentQuery}`,
          { cache: 'no-store' },
        )
        const payload = await response.json().catch(() => null)
        if (cancelled) {
          return
        }
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ||
              payload?.error ||
              `Unable to load transactions (${response.status})`,
          )
        }

        setState({
          status: 'ready',
          transactions: payload.transactions ?? [],
          summary: payload.summary ?? null,
          error: null,
        })
      } catch (error) {
        if (cancelled) {
          return
        }
        setState((previous) => ({
          status: 'unavailable',
          transactions: previous.transactions,
          summary: previous.summary,
          error:
            error instanceof Error
              ? error.message
              : 'Unable to load transactions',
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
  }, [limit, agentId])

  return state
}
