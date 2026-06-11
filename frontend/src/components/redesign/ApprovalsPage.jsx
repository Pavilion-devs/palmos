import { useState } from 'react'
import { Clock, Check, X, ShieldAlert } from 'lucide-react'
import { Shell } from './Shell'
import useDashboardApprovals from '../../hooks/useDashboardApprovals'
import useDashboardTransactions from '../../hooks/useDashboardTransactions'
import { useApprovalDecision } from '../../hooks/useApprovalDecision'
import {
  formatTokenAmount,
  selectActivityRows,
  selectPendingApprovals,
} from './data/selectors'

const tabs = ['Pending', 'Approved', 'Denied']

export function ApprovalsPage() {
  const [tab, setTab] = useState('Pending')
  const { approvals, summary, refresh } = useDashboardApprovals()
  const { transactions } = useDashboardTransactions(100)
  const { decide, pendingKey, error: decisionError } = useApprovalDecision(refresh)

  const pending = selectPendingApprovals(approvals)
  const pendingCount = summary?.totalPending ?? pending.length
  const pendingAmount = summary?.totalAmount

  // Resolved governance outcomes (approximate: executed → Approved, blocked → Denied).
  const resolved = selectActivityRows(transactions)
    .filter((t) => t.tone === 'executed' || t.tone === 'blocked')
    .map((t) => ({
      id: t.id,
      title: t.title,
      agent: t.sub,
      detail: t.status,
      outcome: t.tone === 'blocked' ? 'Denied' : 'Approved',
    }))
  const resolvedRows = resolved.filter((r) => r.outcome === tab)

  return (
    <Shell title="Approvals">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-mono font-semibold text-foreground">{pendingCount}</span> pending
          {pendingCount > 0 && pendingAmount && Number(pendingAmount) > 0 && (
            <>
              <span className="mx-2 text-hairline">·</span>
              <span className="font-mono text-foreground">
                {formatTokenAmount(pendingAmount)} PUSD
              </span>{' '}
              awaiting your sign-off
            </>
          )}
        </p>
        <div className="flex items-center gap-1 self-start rounded-full bg-panel-2 p-1 sm:self-auto">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                tab === t ? 'bg-lime text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {decisionError && (
        <div className="rounded-xl border border-blocked/30 bg-blocked/10 px-3 py-2 text-sm text-blocked">
          {decisionError}
        </div>
      )}

      {tab === 'Pending' ? (
        pending.length === 0 ? (
          <section className="rounded-3xl bg-panel p-6">
            <p className="py-8 text-center text-sm text-muted-foreground">
              No pending approvals — all operations are within policy.
            </p>
          </section>
        ) : (
          <div className="flex flex-col gap-4">
            {pending.map((p) => (
              <section key={p.id ?? p.title} className="rounded-3xl bg-panel p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-pending/15 text-pending">
                      <Clock className="size-5" strokeWidth={2} aria-hidden="true" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h3 className="text-lg font-semibold tracking-tight text-foreground">{p.title}</h3>
                        <span className="font-mono text-sm text-muted-foreground">{p.agent}</span>
                      </div>
                      {p.amount && p.amount !== '—' && (
                        <span className="font-mono text-base font-semibold text-foreground">{p.amount}</span>
                      )}
                      <p className="flex items-center gap-1.5 text-xs text-pending">
                        <ShieldAlert className="size-3.5" strokeWidth={2} aria-hidden="true" />
                        {p.reason}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => decide(p.id, 'approve')}
                      disabled={pendingKey?.startsWith(`${p.id}:`)}
                      className="rounded-full bg-lime px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60"
                    >
                      {pendingKey === `${p.id}:approve` ? 'Approving…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(p.id, 'reject')}
                      disabled={pendingKey?.startsWith(`${p.id}:`)}
                      className="rounded-full border border-hairline px-6 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                    >
                      {pendingKey === `${p.id}:reject` ? 'Denying…' : 'Deny'}
                    </button>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )
      ) : (
        <section className="rounded-3xl bg-panel p-6">
          {resolvedRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing {tab.toLowerCase()} recently.</p>
          ) : (
            <div className="flex flex-col">
              {resolvedRows.map((r, i) => (
                <div key={r.id ?? `${r.title}-${i}`} className={`flex items-center gap-4 py-4 ${i !== 0 ? 'border-t border-hairline' : ''}`}>
                  <div
                    className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                      r.outcome === 'Approved' ? 'bg-lime/15 text-lime' : 'bg-blocked/15 text-blocked'
                    }`}
                  >
                    {r.outcome === 'Approved' ? (
                      <Check className="size-5" strokeWidth={2.5} aria-hidden="true" />
                    ) : (
                      <X className="size-5" strokeWidth={2.5} aria-hidden="true" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-foreground">{r.title}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{r.agent} · {r.detail}</span>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                      r.outcome === 'Approved' ? 'bg-lime/15 text-lime' : 'bg-blocked/15 text-blocked'
                    }`}
                  >
                    {r.outcome}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </Shell>
  )
}
