import { useCallback, useEffect, useRef, useState } from 'react'
import { adaptShowcaseSnapshot } from './dashboardSnapshot'

const API_BASE_URL = import.meta.env.VITE_DASHBOARD_API_BASE_URL || ''
const POLL_INTERVAL_MS = Number(
  import.meta.env.VITE_DASHBOARD_POLL_INTERVAL_MS || '3000',
)

const EMPTY_DASHBOARD_DATA = {
  source: 'live',
  headline: 'Live dashboard',
  generatedAt: null,
  agents: [],
  services: [],
  events: [],
  pendingApprovals: [],
  totalSpent: 0,
  totalAgentCount: 0,
  activeCount: 0,
  pendingCount: 0,
  summary: {},
}

function buildApiUrl(path) {
  if (!API_BASE_URL) {
    return path
  }

  return `${API_BASE_URL}${path}`
}

async function readApiPayload(response, fallbackMessage) {
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(payload?.error || `${fallbackMessage} (${response.status})`)
  }

  return payload
}

export default function useDashboardStore() {
  const actionPendingRef = useRef(false)
  const [liveState, setLiveState] = useState({
    connectionStatus: 'connecting',
    data: EMPTY_DASHBOARD_DATA,
    error: null,
    actionPending: false,
  })

  const applySnapshot = useCallback((snapshot, overrides = {}) => {
    setLiveState((previous) => ({
      ...previous,
      ...overrides,
      connectionStatus: 'live',
      data: {
        ...adaptShowcaseSnapshot(snapshot),
        services: overrides.services ?? previous.data.services ?? [],
      },
      error: null,
    }))
  }, [])

  const refreshSnapshot = useCallback(async () => {
    if (actionPendingRef.current) {
      return
    }

    try {
      const [response, servicesResponse] = await Promise.all([
        fetch(buildApiUrl('/api/dashboard/snapshot'), {
          cache: 'no-store',
        }),
        fetch(buildApiUrl('/api/dashboard/services'), {
          cache: 'no-store',
        }),
      ])
      const snapshot = await readApiPayload(
        response,
        'Unable to load live dashboard snapshot',
      )
      const servicesPayload = await readApiPayload(
        servicesResponse,
        'Unable to load PalmOS services',
      )
      applySnapshot(snapshot, {
        services: servicesPayload.services ?? [],
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to load live dashboard snapshot'
      setLiveState((previous) => ({
        ...previous,
        connectionStatus: 'offline',
        error: message,
      }))
    }
  }, [applySnapshot])

  const runScenario = useCallback(async (agentId) => {
    if (!agentId) {
      setLiveState((previous) => ({
        ...previous,
        error: 'Create or select an agent before running PalmOS.',
      }))
      return
    }

    actionPendingRef.current = true
    setLiveState((previous) => ({
      ...previous,
      actionPending: true,
      error: null,
    }))

    try {
      const response = await fetch(buildApiUrl(`/api/dashboard/agents/${agentId}/run`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      const payload = await readApiPayload(
        response,
        'Unable to run the PalmOS worker',
      )
      applySnapshot(payload.snapshot, {
        actionPending: false,
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to run the PalmOS worker'
      setLiveState((previous) => ({
        ...previous,
        actionPending: false,
        error: message,
      }))
    } finally {
      actionPendingRef.current = false
    }
  }, [applySnapshot])

  const submitApprovalDecision = useCallback(
    async (executionId, decision) => {
      actionPendingRef.current = true
      setLiveState((previous) => ({
        ...previous,
        actionPending: true,
        error: null,
      }))

      try {
        const response = await fetch(
          buildApiUrl(`/api/dashboard/approvals/${executionId}/${decision}`),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          },
        )
        const payload = await readApiPayload(
          response,
          'Approval request failed',
        )
        applySnapshot(payload.snapshot, {
          actionPending: false,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Approval request failed'
        setLiveState((previous) => ({
          ...previous,
          actionPending: false,
          error: message,
        }))
      } finally {
        actionPendingRef.current = false
      }
    },
    [applySnapshot],
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshSnapshot()
    }, 0)
    const intervalId = setInterval(() => {
      void refreshSnapshot()
    }, POLL_INTERVAL_MS)

    return () => {
      clearTimeout(timer)
      clearInterval(intervalId)
    }
  }, [refreshSnapshot])

  return {
    ...liveState.data,
    syncError: liveState.error,
    connectionStatus: liveState.connectionStatus,
    isActionPending: liveState.actionPending,
    approveRequest:
      liveState.connectionStatus === 'live' && !liveState.actionPending
        ? (executionId) => void submitApprovalDecision(executionId, 'approve')
        : () => {},
    denyRequest:
      liveState.connectionStatus === 'live' && !liveState.actionPending
        ? (executionId) => void submitApprovalDecision(executionId, 'reject')
        : () => {},
    approvalsInteractive:
      liveState.connectionStatus === 'live' && !liveState.actionPending,
    onPrimaryAction: runScenario,
    primaryActionLabel: liveState.actionPending
      ? 'Running...'
      : liveState.data.totalAgentCount > 0
        ? 'Run Agent'
        : 'Create Agent',
  }
}
