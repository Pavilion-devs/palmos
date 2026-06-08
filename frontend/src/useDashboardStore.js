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

const EMPTY_SESSION = {
  identity: null,
  capabilities: {
    canMutateDashboard: false,
    canManageOperators: false,
    canUseJudgeMutationMode: false,
  },
}

export function buildApiUrl(path) {
  if (!API_BASE_URL) {
    return path
  }

  return `${API_BASE_URL}${path}`
}

export function fetchDashboardApi(path, options = {}) {
  return fetch(buildApiUrl(path), {
    ...options,
    credentials: 'include',
  })
}

async function readApiPayload(response, fallbackMessage) {
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      payload?.message || payload?.error || `${fallbackMessage} (${response.status})`,
    )
  }

  return payload
}

export default function useDashboardStore() {
  const actionPendingRef = useRef(false)
  const [liveState, setLiveState] = useState({
    connectionStatus: 'connecting',
    data: EMPTY_DASHBOARD_DATA,
    session: EMPTY_SESSION,
    error: null,
    actionPending: false,
  })

  const applySnapshot = useCallback((snapshot, overrides = {}) => {
    setLiveState((previous) => ({
      ...previous,
      ...overrides,
      session: overrides.session ?? previous.session,
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
      const [snapshotResult, servicesResult, sessionResult] =
        await Promise.allSettled([
          fetchDashboardApi('/api/dashboard/snapshot', { cache: 'no-store' }),
          fetchDashboardApi('/api/dashboard/services', { cache: 'no-store' }),
          fetchDashboardApi('/api/dashboard/session', { cache: 'no-store' }),
        ])

      if (snapshotResult.status === 'rejected') {
        throw snapshotResult.reason
      }

      const snapshot = await readApiPayload(
        snapshotResult.value,
        'Unable to load live dashboard snapshot',
      )

      // Services degrade gracefully — a failure keeps the previous lane data
      let servicesOverride
      let sessionOverride
      if (servicesResult.status === 'fulfilled') {
        try {
          const servicesPayload = await readApiPayload(
            servicesResult.value,
            'Unable to load PalmOS services',
          )
          servicesOverride = servicesPayload.services ?? []
        } catch {
          // leave servicesOverride undefined; applySnapshot preserves previous value
        }
      }
      if (sessionResult.status === 'fulfilled') {
        try {
          const sessionPayload = await readApiPayload(
            sessionResult.value,
            'Unable to load dashboard session',
          )
          sessionOverride = {
            identity: sessionPayload.identity ?? null,
            capabilities: {
              ...EMPTY_SESSION.capabilities,
              ...(sessionPayload.capabilities ?? {}),
            },
          }
        } catch {
          sessionOverride = undefined
        }
      }

      applySnapshot(snapshot, {
        services: servicesOverride,
        session: sessionOverride,
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
      const response = await fetchDashboardApi(`/api/dashboard/agents/${agentId}/run`, {
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
        const response = await fetchDashboardApi(
          `/api/dashboard/approvals/${executionId}/${decision}`,
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

  const listAgentCredentials = useCallback(async (agentId) => {
    const response = await fetchDashboardApi(
      `/api/dashboard/agents/${agentId}/credentials`,
      { cache: 'no-store' },
    )
    const payload = await readApiPayload(
      response,
      'Unable to load agent credentials',
    )
    return payload.credentials ?? []
  }, [])

  const createAgentCredential = useCallback(
    async (agentId, label) => {
      const response = await fetchDashboardApi(
        `/api/dashboard/agents/${agentId}/credentials`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(label ? { label } : {}),
        },
      )
      const payload = await readApiPayload(
        response,
        'Unable to create agent credential',
      )
      await refreshSnapshot()
      return { credential: payload.credential, token: payload.token }
    },
    [refreshSnapshot],
  )

  const revokeAgentCredential = useCallback(
    async (credentialId) => {
      const response = await fetchDashboardApi(
        `/api/dashboard/agent-credentials/${credentialId}/revoke`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      const payload = await readApiPayload(
        response,
        'Unable to revoke agent credential',
      )
      await refreshSnapshot()
      return payload.credential
    },
    [refreshSnapshot],
  )

  const updateAgentCredential = useCallback(
    async (credentialId, input) => {
      const response = await fetchDashboardApi(
        `/api/dashboard/agent-credentials/${credentialId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      )
      const payload = await readApiPayload(
        response,
        'Unable to update agent credential',
      )
      await refreshSnapshot()
      return payload.credential
    },
    [refreshSnapshot],
  )

  const rotateAgentCredential = useCallback(
    async (credentialId, label) => {
      const response = await fetchDashboardApi(
        `/api/dashboard/agent-credentials/${credentialId}/rotate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(label ? { label } : {}),
        },
      )
      const payload = await readApiPayload(
        response,
        'Unable to rotate agent credential',
      )
      await refreshSnapshot()
      return { credential: payload.credential, token: payload.token }
    },
    [refreshSnapshot],
  )

  const createAgent = useCallback(
    async (setup) => {
      const response = await fetchDashboardApi('/api/dashboard/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup }),
      })
      const payload = await readApiPayload(
        response,
        'Unable to create PalmOS agent',
      )
      applySnapshot(payload.snapshot, {
        services: liveState.data.services,
      })
      return payload.agent
    },
    [applySnapshot, liveState.data.services],
  )

  const updateAgentPolicy = useCallback(
    async (agentId, patch) => {
      const response = await fetchDashboardApi(
        `/api/dashboard/agents/${agentId}/policy`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
      )
      const payload = await readApiPayload(
        response,
        'Unable to update agent policy',
      )
      applySnapshot(payload.snapshot, {
        services: liveState.data.services,
      })
      return payload.agent
    },
    [applySnapshot, liveState.data.services],
  )

  const runAgentLifecycleAction = useCallback(
    async (agentId, action) => {
      const response = await fetchDashboardApi(
        `/api/dashboard/agents/${agentId}/actions/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      const payload = await readApiPayload(
        response,
        'Unable to update agent lifecycle',
      )
      applySnapshot(payload.snapshot, {
        services: liveState.data.services,
      })
      return payload.agent
    },
    [applySnapshot, liveState.data.services],
  )

  const registerService = useCallback(
    async (input) => {
      const response = await fetchDashboardApi('/api/dashboard/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const payload = await readApiPayload(
        response,
        'Unable to register PalmOS service',
      )
      await refreshSnapshot()
      return payload.service
    },
    [refreshSnapshot],
  )

  const allowServiceForAgent = useCallback(
    async (agentId, serviceId) => {
      const response = await fetchDashboardApi(
        `/api/dashboard/agents/${agentId}/services/${serviceId}/allow`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      const payload = await readApiPayload(
        response,
        'Unable to allow service for agent',
      )
      await refreshSnapshot()
      return payload.service
    },
    [refreshSnapshot],
  )

  const unallowServiceForAgent = useCallback(
    async (agentId, serviceId) => {
      const response = await fetchDashboardApi(
        `/api/dashboard/agents/${agentId}/services/${serviceId}/unallow`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      const payload = await readApiPayload(
        response,
        'Unable to remove service from agent',
      )
      await refreshSnapshot()
      return payload.service
    },
    [refreshSnapshot],
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
    session: liveState.session,
    capabilities: liveState.session.capabilities,
    syncError: liveState.error,
    connectionStatus: liveState.connectionStatus,
    isActionPending: liveState.actionPending,
    approveRequest:
      liveState.connectionStatus === 'live' &&
      liveState.session.capabilities.canMutateDashboard &&
      !liveState.actionPending
        ? (executionId) => submitApprovalDecision(executionId, 'approve')
        : () => {},
    denyRequest:
      liveState.connectionStatus === 'live' &&
      liveState.session.capabilities.canMutateDashboard &&
      !liveState.actionPending
        ? (executionId) => submitApprovalDecision(executionId, 'reject')
        : () => {},
    approvalsInteractive:
      liveState.connectionStatus === 'live' &&
      liveState.session.capabilities.canMutateDashboard &&
      !liveState.actionPending,
    onPrimaryAction: runScenario,
    primaryActionLabel: liveState.actionPending
      ? 'Running...'
      : liveState.data.totalAgentCount > 0
        ? 'Run Agent'
        : 'Register Agent',
    listAgentCredentials,
    createAgent: liveState.session.capabilities.canMutateDashboard
      ? createAgent
      : undefined,
    updateAgentPolicy: liveState.session.capabilities.canMutateDashboard
      ? updateAgentPolicy
      : undefined,
    runAgentLifecycleAction: liveState.session.capabilities.canMutateDashboard
      ? runAgentLifecycleAction
      : undefined,
    createAgentCredential: liveState.session.capabilities.canMutateDashboard
      ? createAgentCredential
      : undefined,
    revokeAgentCredential: liveState.session.capabilities.canMutateDashboard
      ? revokeAgentCredential
      : undefined,
    updateAgentCredential: liveState.session.capabilities.canMutateDashboard
      ? updateAgentCredential
      : undefined,
    rotateAgentCredential: liveState.session.capabilities.canMutateDashboard
      ? rotateAgentCredential
      : undefined,
    registerService: liveState.session.capabilities.canMutateDashboard
      ? registerService
      : undefined,
    allowServiceForAgent: liveState.session.capabilities.canMutateDashboard
      ? allowServiceForAgent
      : undefined,
    unallowServiceForAgent: liveState.session.capabilities.canMutateDashboard
      ? unallowServiceForAgent
      : undefined,
  }
}
