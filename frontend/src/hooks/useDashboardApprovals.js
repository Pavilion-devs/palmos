import { useCallback, useEffect, useState } from 'react'
import { fetchDashboardApi } from '../useDashboardStore'

const POLL_INTERVAL_MS = Number(
  import.meta.env.VITE_DASHBOARD_POLL_INTERVAL_MS || '3000',
)

const INITIAL_STATE = {
  // 'idle' — no successful fetch yet; 'ready' — last fetch ok; 'unavailable' — failed
  status: 'idle',
  approvals: [],
  summary: null,
  error: null,
}

/**
 * Polls the unified `/api/dashboard/approvals` projection (legacy paid-call
 * approvals + native wallet-action approvals). Exposes refresh() so a decision
 * mutation can update the queue immediately instead of waiting for the next poll.
 */
export default function useDashboardApprovals() {
  const [state, setState] = useState(INITIAL_STATE)

  const refresh = useCallback(async () => {
    try {
      const response = await fetchDashboardApi('/api/dashboard/approvals', {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null)
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
      setState((previous) => ({
        status: 'unavailable',
        approvals: previous.approvals,
        summary: previous.summary,
        error:
          error instanceof Error ? error.message : 'Unable to load approvals',
      }))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const intervalId = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [refresh])

  return { ...state, refresh }
}
