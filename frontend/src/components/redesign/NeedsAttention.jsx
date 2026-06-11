import { Clock, ShieldCheck } from 'lucide-react'
import useDashboardApprovals from '../../hooks/useDashboardApprovals'
import { useApprovalDecision } from '../../hooks/useApprovalDecision'
import { selectPendingApprovals } from './data/selectors'

export function NeedsAttention() {
  const { status, approvals, refresh } = useDashboardApprovals()
  const { decide, pendingKey, error } = useApprovalDecision(refresh)
  const items = selectPendingApprovals(approvals)

  return (
    <section className="flex flex-col rounded-3xl bg-panel p-6">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">Needs attention</h2>

      {error && (
        <div className="mt-3 rounded-xl border border-blocked/30 bg-blocked/10 px-3 py-2 text-xs text-blocked">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {items.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-hairline bg-panel-2 p-4 text-sm text-muted-foreground">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-lime/15 text-lime">
              <ShieldCheck className="size-4.5" strokeWidth={2} aria-hidden="true" />
            </div>
            {status === 'idle'
              ? 'Loading…'
              : 'Nothing needs your attention — all operations are within policy.'}
          </div>
        ) : (
          items.map((it) => {
            const busy = pendingKey?.startsWith(`${it.id}:`)
            return (
              <div
                key={it.id ?? it.title}
                className="flex flex-col gap-3 rounded-2xl border border-hairline bg-panel-2 p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-pending/15 text-pending">
                    <Clock className="size-4.5" strokeWidth={2} aria-hidden="true" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-semibold text-foreground">{it.title}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {[it.agent, it.amount].filter((p) => p && p !== '—').join(' · ')}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => decide(it.id, 'approve')}
                    disabled={busy}
                    className="flex-1 rounded-full bg-lime px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60"
                  >
                    {pendingKey === `${it.id}:approve` ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(it.id, 'reject')}
                    disabled={busy}
                    className="flex-1 rounded-full border border-hairline px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                  >
                    {pendingKey === `${it.id}:reject` ? 'Denying…' : 'Deny'}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
