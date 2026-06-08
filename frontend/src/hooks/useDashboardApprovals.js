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
  approvals: [],
  summary: null,
  error: null,
}

/**
 * Polls the unified `/api/dashboard/approvals` projection (legacy paid-call
 * approvals + native wallet-action approvals). Mirrors useDashboardTransactions
 * so the approval queue and nav badge can prefer the dedicated route while
 * falling back to snapshot-derived approvals when it is unavailable.
 */
export default function useDashboardApprovals() {
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
        const response = await fetchDashboardApi('/api/dashboard/approvals', {
          cache: 'no-store',
        })
        const payload = await response.json().catch(() => null)
        if (cancelled) {
          return
        }
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ||
              payload?.error ||
              `Unable to load approvals (${response.status})`,
          )
        }

        setState({
          status: 'ready',
          approvals: payload.approvals ?? [],
          summary: payload.summary ?? null,
          error: null,
        })
      } catch (error) {
        if (cancelled) {
          return
        }
        setState((previous) => ({
          status: 'unavailable',
          approvals: previous.approvals,
          summary: previous.summary,
          error:
            error instanceof Error ? error.message : 'Unable to load approvals',
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
