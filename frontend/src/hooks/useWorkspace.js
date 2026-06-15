import { useCallback, useEffect, useState } from 'react'
import { fetchDashboardApi } from '../useDashboardStore'

// Loads the current workspace record (id + display name) from the dashboard
// session endpoint. Used by the sidebar (name) and Settings (editable name).
export function useWorkspace() {
  const [workspace, setWorkspace] = useState(null)
  const [status, setStatus] = useState('loading')

  const refresh = useCallback(async () => {
    try {
      const response = await fetchDashboardApi('/api/dashboard/session', {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null)
      if (response.ok && payload?.workspace) {
        setWorkspace(payload.workspace)
        setStatus('ready')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { workspace, status, refresh }
}
