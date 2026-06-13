import { Shell } from './Shell'
import { StatCards } from './StatCards'
import { AssetsChart } from './AssetsChart'
import { RecentActivity } from './RecentActivity'
import { NeedsAttention } from './NeedsAttention'
import { useAgentWallets } from '../../hooks/useAgentWallets'
import useDashboardApprovals from '../../hooks/useDashboardApprovals'
import { useAssetsHistory } from '../../hooks/useAssetsHistory'
import useDashboardTransactions from '../../hooks/useDashboardTransactions'

export function OverviewPage() {
  const agentsState = useAgentWallets()
  const approvalsState = useDashboardApprovals()
  const assetsHistoryState = useAssetsHistory()
  const transactionsState = useDashboardTransactions(5)

  return (
    <Shell title="Overview">
      <StatCards
        status={agentsState.status}
        agents={agentsState.agents}
        approvals={approvalsState.approvals}
        approvalsSummary={approvalsState.summary}
      />
      <AssetsChart
        agents={agentsState.agents}
        historyStatus={assetsHistoryState.status}
        series={assetsHistoryState.series}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <RecentActivity
          status={transactionsState.status}
          transactions={transactionsState.transactions}
        />
        <NeedsAttention
          status={approvalsState.status}
          approvals={approvalsState.approvals}
          refresh={approvalsState.refresh}
        />
      </div>
    </Shell>
  )
}
