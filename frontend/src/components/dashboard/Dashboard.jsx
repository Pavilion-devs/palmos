import { Plus } from 'lucide-react'
import { useState } from 'react'
import useDashboardStore from '../../useDashboardStore'
import useHashRoute, { navigate, parseDashboardRoute } from '../../hooks/useHashRoute'
import DashboardOnboarding from './DashboardOnboarding'
import DashboardShell from './shell/DashboardShell'
import Topbar from './shell/Topbar'
import DashboardHomePage from './pages/DashboardHomePage'
import MyAgentsPage from './pages/MyAgentsPage'
import AgentDetailPage from './pages/AgentDetailPage'
import ServicesPage from './pages/ServicesPage'
import ServiceDetailPage from './pages/ServiceDetailPage'
import TransactionsPage from './pages/TransactionsPage'
import TransactionDetailPage from './pages/TransactionDetailPage'
import ApprovalsPage from './pages/ApprovalsPage'
import SettingsPage from './pages/SettingsPage'

const PAGE_META = {
  home: { subtitle: 'Operations', title: 'Dashboard' },
  agents: { subtitle: 'Agents', title: 'My Agents' },
  'agent-detail': { subtitle: 'Agents', title: 'Agent Detail' },
  services: { subtitle: 'Services', title: 'Service Registry' },
  'service-detail': { subtitle: 'Services', title: 'Service Detail' },
  transactions: { subtitle: 'Transactions', title: 'Paid Calls' },
  'transaction-detail': { subtitle: 'Transactions', title: 'Transaction Detail' },
  approvals: { subtitle: 'Approvals', title: 'Approval Queue' },
  settings: { subtitle: 'Settings', title: 'Workspace Controls' },
}

const STUB_NAV = {
  home: 'home',
  agents: 'agents',
  'agent-detail': 'agents',
  services: 'services',
  'service-detail': 'services',
  transactions: 'transactions',
  'transaction-detail': 'transactions',
  approvals: 'approvals',
  settings: 'settings',
}

export default function Dashboard() {
  const hash = useHashRoute()
  const route = parseDashboardRoute(hash)

  const {
    agents,
    services,
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
    pendingCount,
    listAgentCredentials,
    createAgent,
    updateAgentPolicy,
    runAgentLifecycleAction,
    createAgentCredential,
    revokeAgentCredential,
    updateAgentCredential,
    rotateAgentCredential,
    registerService,
    allowServiceForAgent,
    unallowServiceForAgent,
  } = useDashboardStore()

  const [localCreatedAgentId, setLocalCreatedAgentId] = useState(null)
  const [agentCreateOpen, setAgentCreateOpen] = useState(false)
  const [setupComplete, setSetupComplete] = useState(() => {
    return (
      !window.location.hash.includes('onboarding') &&
      (window.localStorage.getItem('palmos.dashboard.setup') !== null ||
        window.localStorage.getItem('palmos.dashboard.selectedAgentId') !== null)
    )
  })

  const shouldShowOnboarding =
    route.page === 'onboarding' ||
    (!setupComplete && !(connectionStatus === 'live' && agents.length > 0)) ||
    (connectionStatus === 'live' && agents.length === 0 && !localCreatedAgentId)

  if (shouldShowOnboarding) {
    return (
      <DashboardOnboarding
        onComplete={(setup) => {
          setLocalCreatedAgentId(setup.agentId ?? null)
          setSetupComplete(true)
          if (setup.agentId) {
            navigate(`#dashboard/agents/${setup.agentId}`)
          } else {
            navigate('#dashboard')
          }
        }}
      />
    )
  }

  function handleCreateAgent() {
    if (createAgent) {
      navigate('#dashboard/agents')
      setAgentCreateOpen(true)
      return
    }
    navigate('#dashboard/onboarding')
    setSetupComplete(false)
  }

  function getFocusedAgentId() {
    if (route.page === 'agent-detail') return route.agentId
    return agents[0]?.id ?? null
  }

  function handlePrimaryAction() {
    const focusedAgentId = getFocusedAgentId()
    if (!focusedAgentId) {
      handleCreateAgent()
      return
    }
    onPrimaryAction(focusedAgentId)
  }

  const meta = PAGE_META[route.page] ?? PAGE_META.home
  const activeNav = STUB_NAV[route.page] ?? 'home'

  const topbarRightSlot =
    route.page === 'agents' ? (
      <button
        type="button"
        onClick={handleCreateAgent}
        className="hidden items-center gap-2 border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white sm:inline-flex"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        New agent
      </button>
    ) : null

  const topbar = (
    <Topbar
      pageSubtitle={meta.subtitle}
      pageTitle={meta.title}
      connectionStatus={connectionStatus}
      generatedAt={generatedAt}
      isActionPending={isActionPending}
      actionLabel={route.page === 'home' ? primaryActionLabel : null}
      onAction={route.page === 'home' ? handlePrimaryAction : null}
      rightSlot={topbarRightSlot}
    />
  )

  return (
    <DashboardShell
      activePage={activeNav}
      pendingCount={pendingCount}
      topbar={topbar}
      syncError={syncError}
    >
      {route.page === 'home' && (
        <DashboardHomePage
          agents={agents}
          services={services}
          events={events}
          pendingApprovals={pendingApprovals}
          totalSpent={totalSpent}
          pendingCount={pendingCount}
          onApprove={approveRequest}
          onDeny={denyRequest}
          approvalsInteractive={approvalsInteractive}
        />
      )}

      {route.page === 'agents' && (
        <MyAgentsPage
          agents={agents}
          onCreateAgent={handleCreateAgent}
          createAgent={createAgent}
          createOpen={agentCreateOpen}
          onCreateOpenChange={setAgentCreateOpen}
        />
      )}

      {route.page === 'agent-detail' && (
        <AgentDetailPage
          agentId={route.agentId}
          agents={agents}
          services={services}
          events={events}
          pendingApprovals={pendingApprovals}
          onRunAgent={onPrimaryAction}
          isActionPending={isActionPending}
          updateAgentPolicy={updateAgentPolicy}
          runAgentLifecycleAction={runAgentLifecycleAction}
          listAgentCredentials={listAgentCredentials}
          createAgentCredential={createAgentCredential}
          revokeAgentCredential={revokeAgentCredential}
          updateAgentCredential={updateAgentCredential}
          rotateAgentCredential={rotateAgentCredential}
          allowServiceForAgent={allowServiceForAgent}
          unallowServiceForAgent={unallowServiceForAgent}
        />
      )}

      {route.page === 'services' && (
        <ServicesPage services={services} registerService={registerService} />
      )}

      {route.page === 'service-detail' && (
        <ServiceDetailPage
          serviceId={route.serviceId}
          services={services}
          agents={agents}
          events={events}
          allowServiceForAgent={allowServiceForAgent}
        />
      )}

      {route.page === 'transactions' && (
        <TransactionsPage events={events} agents={agents} services={services} />
      )}

      {route.page === 'transaction-detail' && (
        <TransactionDetailPage
          executionId={route.executionId}
          events={events}
          agents={agents}
          services={services}
        />
      )}

      {route.page === 'approvals' && (
        <ApprovalsPage
          pendingApprovals={pendingApprovals}
          events={events}
          agents={agents}
          services={services}
          onApprove={approveRequest}
          onDeny={denyRequest}
          approvalsInteractive={approvalsInteractive}
        />
      )}

      {route.page === 'settings' && (
        <SettingsPage agents={agents} services={services} events={events} />
      )}
    </DashboardShell>
  )
}
