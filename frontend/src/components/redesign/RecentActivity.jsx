import {
  ArrowLeftRight,
  Send,
  Coins,
  KeyRound,
  ShieldAlert,
  Activity,
  Zap,
  ArrowDownToLine,
} from 'lucide-react'
import useDashboardTransactions from '../../hooks/useDashboardTransactions'
import { selectActivityRows } from './data/selectors'

const statusStyles = {
  executed: 'bg-lime/15 text-lime',
  pending: 'bg-pending/15 text-pending',
  blocked: 'bg-blocked/15 text-blocked',
}

const typeIcons = {
  Swap: ArrowLeftRight,
  Transfer: Send,
  Payment: Coins,
  Wallet: KeyRound,
  Agent: Zap,
  Deposit: ArrowDownToLine,
  Action: Activity,
}

export function RecentActivity() {
  const { status, transactions } = useDashboardTransactions(5)
  const items = selectActivityRows(transactions).slice(0, 5)

  return (
    <section className="flex flex-col rounded-3xl bg-panel p-6">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">Recent activity</h2>

      <div className="mt-4 flex flex-col">
        {status === 'idle' && items.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading activity…</div>
        )}
        {status !== 'idle' && items.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No agent activity yet.
          </div>
        )}
        {items.map((it, i) => {
          const Icon = it.tone === 'blocked' ? ShieldAlert : (typeIcons[it.type] ?? Activity)
          return (
            <div
              key={it.id ?? `${it.title}-${i}`}
              className={`flex items-center gap-4 py-4 ${i !== 0 ? 'border-t border-hairline' : ''}`}
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-panel-2 text-foreground">
                <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-foreground">{it.title}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">{it.sub}</span>
              </div>

              <span
                className={`hidden shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium sm:inline-flex ${statusStyles[it.tone] ?? statusStyles.pending}`}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {it.status}
              </span>

              <span className="shrink-0 font-mono text-xs text-muted-foreground">{it.time}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
