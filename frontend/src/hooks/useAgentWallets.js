import { useCallback, useEffect, useState } from 'react'
import { fetchDashboardApi } from '../useDashboardStore'

const POLL_INTERVAL_MS = 3000

// Reads the live wallet snapshot list (GET /api/dashboard/agent-wallets). Use
// this only on screens that actually need balances or holdings; the cheaper
// roster hook is still the source for onboarding and control metadata.
export function useAgentWallets({ poll = false } = {}) {
  const [state, setState] = useState({
    status: 'loading', // 'loading' | 'ready' | 'error'
    agents: [],
    error: '',
  })

  const refresh = useCallback(async () => {
    try {
      const response = await fetchDashboardApi('/api/dashboard/agent-wallets', {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null)
      if (response.ok && payload?.ok) {
        setState({
          status: 'ready',
          agents: payload.agents ?? [],
          error: '',
        })
      } else {
        setState((previous) => ({
          status: 'error',
          agents: previous.agents,
          error:
            payload?.error ||
            `Unable to load agent wallets (${response.status})`,
        }))
      }
    } catch (error) {
      setState((previous) => ({
        status: 'error',
        agents: previous.agents,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to load agent wallets',
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
