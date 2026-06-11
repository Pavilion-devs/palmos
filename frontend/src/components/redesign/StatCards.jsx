import { ArrowUpRight, Shield, Wallet, ShieldCheck } from 'lucide-react'
import { useAgents } from '../../hooks/useAgents'
import useDashboardApprovals from '../../hooks/useDashboardApprovals'
import {
  activeWalletCount,
  assetsUnderControl,
  formatTokenAmount,
  formatUsd,
} from './data/selectors'

const variantStyles = {
  lime: {
    card: 'bg-lime text-primary-foreground',
    iconText: 'text-primary-foreground',
    ring: 'border-primary-foreground/20',
    labelText: 'text-primary-foreground/70',
    subText: 'text-primary-foreground/70',
    button: 'bg-primary-foreground',
    arrow: 'text-lime',
  },
  blue: {
    card: 'bg-[#2563eb] text-white',
    iconText: 'text-white',
    ring: 'border-white/30',
    labelText: 'text-white/75',
    subText: 'text-white/70',
    button: 'bg-white',
    arrow: 'text-[#2563eb]',
  },
  white: {
    card: 'bg-white text-[#0a0b0a]',
    iconText: 'text-[#0a0b0a]',
    ring: 'border-[#0a0b0a]/15',
    labelText: 'text-[#0a0b0a]/60',
    subText: 'text-[#0a0b0a]/55',
    button: 'bg-[#0a0b0a]',
    arrow: 'text-white',
  },
}

function StatCard({ variant, icon: Icon, label, value, sub }) {
  const s = variantStyles[variant]
  return (
    <div className={`flex min-h-[210px] flex-col justify-between rounded-3xl p-6 ${s.card}`}>
      {/* Icon in a circular border ring (top-left) */}
      <div className={`flex size-12 items-center justify-center rounded-full border ${s.ring}`}>
        <Icon className={`size-6 ${s.iconText}`} strokeWidth={2} aria-hidden="true" />
      </div>

      {/* Value (bottom-left) + circular arrow (bottom-right) */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <p className={`text-sm font-medium ${s.labelText}`}>{label}</p>
          <p className="font-mono text-5xl font-bold tracking-tight">{value}</p>
          <p className={`font-mono text-xs ${s.subText}`}>{sub}</p>
        </div>
        <button
          type="button"
          aria-label={`Open ${label}`}
          className={`flex size-12 shrink-0 items-center justify-center rounded-full transition-transform hover:-translate-y-0.5 ${s.button}`}
        >
          <ArrowUpRight className={`size-5 ${s.arrow}`} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

export function StatCards() {
  const { status, agents } = useAgents()
  const approvals = useDashboardApprovals()

  const loading = status === 'loading'
  const walletCount = agents.length
  const active = activeWalletCount(agents)
  const auc = assetsUnderControl(agents)
  const pendingCount = approvals.summary?.totalPending ?? approvals.approvals.length
  const pendingAmount = approvals.summary?.totalAmount

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
      <StatCard
        variant="lime"
        icon={Shield}
        label="Assets under control"
        value={loading ? '—' : formatUsd(auc)}
        sub={loading ? ' ' : `${walletCount} wallet${walletCount === 1 ? '' : 's'}`}
      />
      <StatCard
        variant="blue"
        icon={Wallet}
        label="Active wallets"
        value={loading ? '—' : String(walletCount)}
        sub={loading ? ' ' : `${active} active`}
      />
      <StatCard
        variant="white"
        icon={ShieldCheck}
        label="Pending approvals"
        value={loading ? '—' : String(pendingCount)}
        sub={
          loading
            ? ' '
            : pendingCount > 0 && pendingAmount
              ? `${formatTokenAmount(pendingAmount)} PUSD awaiting`
              : 'Nothing awaiting'
        }
      />
    </div>
  )
}
