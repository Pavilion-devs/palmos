import { Navigate, Route, Routes } from 'react-router-dom'
import { useAgents } from '../../hooks/useAgents'
import { OperatorSessionProvider } from '../../hooks/OperatorSessionProvider'
import { useOperatorSession } from '../../hooks/useOperatorSession'
import { OverviewPage } from './OverviewPage'
import { WalletsPage } from './WalletsPage'
import { WalletDetailPage } from './WalletDetailPage'
import { ActivityPage } from './ActivityPage'
import { ApprovalsPage } from './ApprovalsPage'
import { ControlsPage } from './ControlsPage'
import { SettingsPage } from './SettingsPage'
import { ConnectScreen } from './auth/ConnectScreen'
import { WalletProviders } from './auth/WalletProviders'
import { ConnectAgentPage } from './agents/ConnectAgentPage'

// The dark lime-on-black operator dashboard, mounted at /dashboard/*. Gated behind
// a real Sign-In With Solana session, then an agent-first onboarding step when the
// workspace has no agents yet.
function DashboardRoutes() {
  return (
    <Routes>
      <Route index element={<OverviewPage />} />
      <Route path="wallets" element={<WalletsPage />} />
      <Route path="wallets/:agentId" element={<WalletDetailPage />} />
      <Route path="activity" element={<ActivityPage />} />
      <Route path="approvals" element={<ApprovalsPage />} />
      <Route path="controls" element={<ControlsPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="connect" element={<ConnectAgentPage />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

function LoadingScreen({ label = 'Loading session…' }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background font-sans text-muted-foreground antialiased">
      <div className="flex items-center gap-3 text-sm">
        <span className="size-2 animate-pulse rounded-full bg-lime" />
        {label}
      </div>
    </div>
  )
}

function AuthedExperience() {
  const { status, agents, refresh } = useAgents()
  if (status === 'loading') {
    return <LoadingScreen label="Loading workspace…" />
  }
  // Agent-first onboarding: no agents yet → connect-agent hero (not an empty Overview).
  if (status === 'ready' && agents.length === 0) {
    return <ConnectAgentPage onConnected={refresh} />
  }
  return <DashboardRoutes />
}

function RedesignGate() {
  const { status } = useOperatorSession()
  if (status === 'loading') {
    return <LoadingScreen />
  }
  if (status === 'authenticated') {
    return <AuthedExperience />
  }
  return <ConnectScreen />
}

export default function RedesignDashboard() {
  return (
    <WalletProviders>
      <OperatorSessionProvider>
        <div className="redesign-root">
          <RedesignGate />
        </div>
      </OperatorSessionProvider>
    </WalletProviders>
  )
}
