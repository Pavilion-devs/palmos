import {
  ArrowLeftRight,
  Send,
  Coins,
  KeyRound,
  ShieldAlert,
  Activity,
  Zap,
  ArrowDownToLine,
  Droplets,
  ExternalLink,
} from 'lucide-react'
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

export function RecentActivity({ status = 'idle', transactions = [] }) {
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

              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{it.time}</span>
                {it.txUrl && (
                  <a
                    href={it.txUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="View on Solscan"
                    className="text-muted-foreground transition-colors hover:text-lime"
                  >
                    <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" />
                  </a>
                )}
                {it.mantleTxUrl && (
                  <a
                    href={it.mantleTxUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={`Recorded on Mantle${it.mantleOutcome ? ` (${it.mantleOutcome})` : ''}`}
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
  )
}
