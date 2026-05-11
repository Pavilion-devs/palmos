import { CircleDollarSign, Clock3, WalletCards } from 'lucide-react'
import OperationsBoard from '../OperationsBoard'

function formatPusd(value, digits = 3) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '0.000'
}

function BoardStat({ icon, label, value }) {
  const StatIcon = icon
  return (
    <div className="flex items-center gap-2">
      <StatIcon className="h-4 w-4 text-neutral-600" aria-hidden="true" />
      <span className="text-[10px] uppercase tracking-widest text-neutral-600">{label}</span>
      <span className="font-mono text-sm text-white">{value}</span>
    </div>
  )
}

export default function DashboardHomePage({
  agents,
  services,
  events,
  pendingApprovals,
  totalSpent,
  pendingCount,
  onApprove,
  onDeny,
  approvalsInteractive,
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-6 py-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-600">
            Command board
          </div>
          <h2 className="mt-1 text-lg font-medium text-white">PalmOS Operations</h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <BoardStat icon={WalletCards} label="Agents" value={String(agents.length)} />
          <BoardStat
            icon={CircleDollarSign}
            label="Spent"
            value={`${formatPusd(totalSpent)} PUSD`}
          />
          <BoardStat icon={Clock3} label="Pending" value={String(pendingCount)} />
        </div>
      </div>

      <OperationsBoard
        agents={agents}
        services={services}
        events={events}
        pendingApprovals={pendingApprovals}
        onApprove={onApprove}
        onDeny={onDeny}
        approvalsInteractive={approvalsInteractive}
      />
    </div>
  )
}
