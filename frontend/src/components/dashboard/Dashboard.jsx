import { useState } from 'react'
import useDashboardStore from '../../useDashboardStore'
import DashboardHeader from './DashboardHeader'
import AgentSidebar from './AgentSidebar'
import LiveFeed from './LiveFeed'
import ApprovalQueue from './ApprovalQueue'
import AuditLog from './AuditLog'
import PolicyInspector from './PolicyInspector'
import ActivityTicker from './ActivityTicker'
import DashboardOnboarding from './DashboardOnboarding'
import AgentStatusPanel from './AgentStatusPanel'

const TABS = [
  { id: 'feed', label: 'Live Feed' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'policy', label: 'Policy' },
]

export default function Dashboard() {
  const {
    agents,
    events,
    pendingApprovals,
    connectionStatus,
    isActionPending,
    generatedAt,
    syncError,
    onPrimaryAction,
    primaryActionLabel,
    approveRequest,
    denyRequest,
    approvalsInteractive,
    totalSpent,
    totalAgentCount,
    activeCount,
    pendingCount,
  } = useDashboardStore()

  const [activeTab, setActiveTab] = useState('feed')
  const [selectedAgentId, setSelectedAgentId] = useState(() => {
    return window.localStorage.getItem('palmos.dashboard.selectedAgentId')
  })
  const [localCreatedAgentId, setLocalCreatedAgentId] = useState(null)
  const [setupComplete, setSetupComplete] = useState(() => {
    return (
      !window.location.hash.includes('onboarding') &&
      (window.localStorage.getItem('palmos.dashboard.setup') !== null ||
        window.localStorage.getItem('palmos.dashboard.selectedAgentId') !== null)
    )
  })

  const activeAgentId = agents.some((agent) => agent.id === selectedAgentId)
    ? selectedAgentId
    : null

  const filteredEvents = activeAgentId
    ? events.filter((e) => e.agentId === activeAgentId)
    : events

  const filteredApprovals = activeAgentId
    ? pendingApprovals.filter((p) => p.agentId === activeAgentId)
    : pendingApprovals
  const focusedAgent =
    agents.find((agent) => agent.id === activeAgentId) ??
    agents[0]

  const shouldShowOnboarding =
    !setupComplete ||
    (connectionStatus === 'live' && agents.length === 0 && !localCreatedAgentId)

  if (shouldShowOnboarding) {
    return (
      <DashboardOnboarding
        onComplete={(setup) => {
          setSelectedAgentId(setup.agentId ?? null)
          setLocalCreatedAgentId(setup.agentId ?? null)
          setSetupComplete(true)
        }}
      />
    )
  }

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <DashboardHeader
        totalAgentCount={totalAgentCount}
        activeCount={activeCount}
        totalSpent={totalSpent}
        pendingCount={pendingCount}
        connectionStatus={connectionStatus}
        isActionPending={isActionPending}
        generatedAt={generatedAt}
        actionLabel={primaryActionLabel}
        onAction={() => {
          if (!focusedAgent) {
            window.location.hash = '#dashboard/onboarding'
            setSetupComplete(false)
            return
          }

          onPrimaryAction(focusedAgent.id)
        }}
        onResetSetup={() => {
          window.localStorage.removeItem('palmos.dashboard.setup')
          window.localStorage.removeItem('palmos.dashboard.selectedAgentId')
          window.localStorage.removeItem('palmos.dashboard.agentToken')
          window.location.hash = '#dashboard/onboarding'
          setLocalCreatedAgentId(null)
          setSetupComplete(false)
        }}
      />

      {syncError && (
        <div className="border-b border-red-500/20 bg-red-500/5 px-5 py-2">
          <p className="text-xs text-red-300">{syncError}</p>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Left sidebar — agent list */}
        <AgentSidebar
          agents={agents}
          selectedAgentId={activeAgentId}
          onSelectAgent={(id) => {
            const nextId = id === activeAgentId ? null : id
            setSelectedAgentId(nextId)
            if (nextId) {
              window.localStorage.setItem('palmos.dashboard.selectedAgentId', nextId)
            } else {
              window.localStorage.removeItem('palmos.dashboard.selectedAgentId')
            }
          }}
        />

        {/* Main content area */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Tab bar */}
          <div className="flex items-center gap-0 border-b border-neutral-800 bg-neutral-950">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-5 py-3 text-xs font-medium uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${
                  activeTab === tab.id
                    ? 'text-white'
                    : 'text-neutral-600 hover:text-neutral-400'
                }`}
              >
                {tab.label}
                {tab.id === 'approvals' && pendingCount > 0 && (
                  <span className="ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-yellow-500/20 px-1 font-mono text-[10px] text-yellow-400">
                    {pendingCount}
                  </span>
                )}
                {activeTab === tab.id && (
                  <span className="absolute bottom-0 left-0 h-px w-full bg-white" />
                )}
              </button>
            ))}

            {activeAgentId && (
              <div className="ml-auto flex items-center gap-2 pr-5">
                <span className="text-[10px] uppercase tracking-widest text-neutral-600">
                  Filtered: {agents.find((a) => a.id === activeAgentId)?.name}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedAgentId(null)}
                  className="min-h-10 px-2 text-xs text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          <AgentStatusPanel agent={focusedAgent} />

          {/* Tab content */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeTab === 'feed' && <LiveFeed events={filteredEvents} />}
            {activeTab === 'approvals' && (
              <ApprovalQueue
                approvals={filteredApprovals}
                onApprove={approveRequest}
                onDeny={denyRequest}
                interactive={approvalsInteractive}
              />
            )}
            {activeTab === 'audit' && <AuditLog events={filteredEvents} />}
            {activeTab === 'policy' && (
              <PolicyInspector
                agents={agents}
                selectedAgentId={activeAgentId}
                onSelectAgent={(id) => {
                  setSelectedAgentId(id)
                  if (id) {
                    window.localStorage.setItem('palmos.dashboard.selectedAgentId', id)
                  } else {
                    window.localStorage.removeItem('palmos.dashboard.selectedAgentId')
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Bottom activity ticker */}
      <ActivityTicker events={events} />
    </div>
  )
}
