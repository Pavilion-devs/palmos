import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert, Zap, ArrowDownToLine, Bell } from 'lucide-react'
import useDashboardTransactions from '../../../hooks/useDashboardTransactions'
import { selectActivityRows } from '../data/selectors'

function eventIcon(row) {
  if (row.tone === 'blocked') return ShieldAlert
  if (row.type === 'Deposit') return ArrowDownToLine
  if (row.type === 'Agent') return Zap
  return Bell
}

// Bell dropdown: pending approvals (needs attention) + recent agent events
// (connected / funded / blocked). Receives `pending` from the Topbar so the
// badge count and the list share one source.
export function NotificationsPanel({ pending = [], onClose }) {
  const navigate = useNavigate()
  const { transactions } = useDashboardTransactions(25)
  const events = selectActivityRows(transactions)
    .filter(
      (row) =>
        row.type === 'Agent' || row.type === 'Deposit' || row.tone === 'blocked',
    )
    .slice(0, 6)

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function go(to) {
    onClose?.()
    navigate(to)
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close notifications"
        onClick={onClose}
        className="fixed inset-0 z-40"
      />
      <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-[var(--radius)] border border-hairline bg-panel shadow-2xl">
        <div className="border-b border-hairline px-4 py-3 text-sm font-semibold text-foreground">
          Notifications
        </div>
        <div className="max-h-[70vh] overflow-y-auto py-1">
          {pending.length > 0 && (
            <p className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Needs attention
            </p>
          )}
          {pending.map((p) => (
            <button
              key={p.id ?? p.title}
              type="button"
              onClick={() => go('/dashboard/approvals')}
              className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-panel-2"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-pending" aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{p.title}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {[p.agent, p.amount].filter((x) => x && x !== '—').join(' · ')}
                </span>
              </span>
            </button>
          ))}

          {events.length > 0 && (
            <p className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Recent
            </p>
          )}
          {events.map((row, i) => {
            const Icon = eventIcon(row)
            return (
              <button
                key={row.id ?? `${row.title}-${i}`}
                type="button"
                onClick={() => go('/dashboard/activity')}
                className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-panel-2"
              >
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${row.tone === 'blocked' ? 'text-blocked' : 'text-muted-foreground'}`}
                  aria-hidden="true"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{row.title}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{row.sub}</span>
                </span>
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{row.time}</span>
              </button>
            )
          })}

          {pending.length === 0 && events.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              You’re all caught up.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
