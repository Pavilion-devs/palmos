import { Shell } from './Shell'
import { StatCards } from './StatCards'
import { AssetsChart } from './AssetsChart'
import { RecentActivity } from './RecentActivity'
import { NeedsAttention } from './NeedsAttention'

export function OverviewPage() {
  return (
    <Shell title="Overview">
      <StatCards />
      <AssetsChart />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.7fr_1fr]">
        <RecentActivity />
        <NeedsAttention />
      </div>
    </Shell>
  )
}
