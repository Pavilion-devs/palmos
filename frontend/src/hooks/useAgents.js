import { useCallback, useEffect, useState } from 'react'
import { fetchDashboardApi } from '../useDashboardStore'

const POLL_INTERVAL_MS = 3000

// Reads the workspace agent roster (GET /api/dashboard/agents). Drives the
// 0-agents onboarding gate and the "waiting for your agent…" poll. Set
// { poll: true } to refresh on an interval.
export function useAgents({ poll = false } = {}) {
  const [state, setState] = useState({
    status: 'loading', // 'loading' | 'ready' | 'error'
    agents: [],
    summary: null,
    error: '',
  })

  const refresh = useCallback(async () => {
    try {
      const response = await fetchDashboardApi('/api/dashboard/agents', {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null)
      if (response.ok && payload?.ok) {
        setState({
          status: 'ready',
          agents: payload.agents ?? [],
          summary: payload.summary ?? null,
          error: '',
        })
      } else {
        setState((previous) => ({
          status: 'error',
          agents: previous.agents,
          summary: previous.summary,
          error: payload?.error || `Unable to load agents (${response.status})`,
        }))
      }
    } catch (error) {
      setState((previous) => ({
        status: 'error',
        agents: previous.agents,
        summary: previous.summary,
        error: error instanceof Error ? error.message : 'Unable to load agents',
      }))
    }
  }, [])

  useEffect(() => {
    void refresh()
    if (!poll) {
      return undefined
    }
    const intervalId = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [refresh, poll])

  return { ...state, refresh }
}
