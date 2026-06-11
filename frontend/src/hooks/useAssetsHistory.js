import { useEffect, useState } from 'react'
import { fetchDashboardApi } from '../useDashboardStore'

// Cross-agent assets-under-control time-series (GET /api/dashboard/assets-under-control/history).
// Polled slowly — portfolio snapshots are captured on a cron, not in real time.
export function useAssetsHistory() {
  const [state, setState] = useState({ status: 'loading', series: [], error: '' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await fetchDashboardApi(
          '/api/dashboard/assets-under-control/history?limit=90',
          { cache: 'no-store' },
        )
        const payload = await response.json().catch(() => null)
        if (cancelled) return
        if (response.ok && payload?.ok) {
          setState({ status: 'ready', series: payload.series ?? [], error: '' })
        } else {
          setState((previous) => ({
            status: 'error',
            series: previous.series,
            error: payload?.error || `Unable to load history (${response.status})`,
          }))
        }
      } catch (error) {
        if (cancelled) return
        setState((previous) => ({
          status: 'error',
          series: previous.series,
          error: error instanceof Error ? error.message : 'Unable to load history',
        }))
      }
    }
    void load()
    const intervalId = setInterval(() => void load(), 15000)
    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [])

  return state
}
