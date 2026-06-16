import { useState } from 'react'
import {
  ArrowLeftRight,
  Send,
  Coins,
  ShieldAlert,
  KeyRound,
  Activity,
  Zap,
  ArrowDownToLine,
  Droplets,
  ExternalLink,
} from 'lucide-react'
import { Shell } from './Shell'
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
  Liquidity: Droplets,
  Action: Activity,
}

const tabs = ['All', 'Swaps', 'Liquidity', 'Transfers', 'Payments', 'Blocked']
const tabMatch = { Swaps: 'Swap', Liquidity: 'Liquidity', Transfers: 'Transfer', Payments: 'Payment' }

export function ActivityPage() {
  const [tab, setTab] = useState('All')
  const { status, transactions } = useDashboardTransactions(100)
  const all = selectActivityRows(transactions)
  const rows = all.filter((o) =>
    tab === 'All'
      ? true
      : tab === 'Blocked'
        ? o.tone === 'blocked'
        : o.type === tabMatch[tab],
  )

  return (
    <Shell title="Activity">
      <section className="flex min-h-0 flex-1 flex-col rounded-3xl bg-panel p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Operations</h2>
            <p className="font-mono text-xs text-muted-foreground">Every action across all agent wallets</p>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-panel-2 p-1">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                  tab === t ? 'bg-lime text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 hidden grid-cols-[minmax(0,2.2fr)_0.9fr_1fr_0.9fr_184px] items-center gap-4 px-2 pb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground lg:grid">
          <span>Operation</span>
          <span>Type</span>
          <span>Amount</span>
          <span>Status</span>
          <span className="text-right">Time</span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {status === 'idle' && all.length === 0 && (
            <div className="px-2 py-10 text-center text-sm text-muted-foreground">Loading operations…</div>
          )}
          {status !== 'idle' && rows.length === 0 && (
            <div className="px-2 py-10 text-center text-sm text-muted-foreground">
              {all.length === 0 ? 'No operations yet.' : 'No operations match this filter.'}
            </div>
          )}
          {rows.map((o, i) => {
            const Icon = o.tone === 'blocked' ? ShieldAlert : (typeIcons[o.type] ?? Activity)
            return (
              <div
                key={o.id ?? `${o.title}-${i}`}
                className={`grid grid-cols-1 items-center gap-4 px-2 py-4 lg:grid-cols-[minmax(0,2.2fr)_0.9fr_1fr_0.9fr_184px] ${
                  i !== 0 ? 'border-t border-hairline' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-panel-2 text-foreground">
                    <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-foreground">{o.title}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{o.sub}</span>
                  </div>
                </div>
                <div>
                  <span className="inline-flex rounded-full border border-hairline bg-panel-2 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {o.type}
                  </span>
                </div>
                <div className="whitespace-nowrap font-mono text-sm text-foreground">{o.amount}</div>
                <div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${statusStyles[o.tone] ?? statusStyles.pending}`}>
                    <span className="size-1.5 rounded-full bg-current" />
                    {o.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground lg:justify-end">
                  <span>{o.time}</span>
                  {o.txUrl && (
                    <a
                      href={o.txUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="View on Solscan"
                      className="text-muted-foreground transition-colors hover:text-lime"
                    >
                      <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    </a>
                  )}
                  {o.mantleTxUrl && (
                    <a
                      href={o.mantleTxUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={`Recorded on Mantle${o.mantleOutcome ? ` (${o.mantleOutcome})` : ''}`}
                      className="inline-flex items-center gap-1 rounded-full bg-lime/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-lime transition-colors hover:bg-lime/20"
                    >
                      Mantle
                      <ExternalLink className="size-3" strokeWidth={2} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </Shell>
  )
}
