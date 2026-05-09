import { ArrowRight, MessageSquare, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { navigate } from '../../../hooks/useHashRoute'

function formatPusd(value, digits = 3) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '0.000'
}

function relativeTimestamp(ms) {
  if (!ms) return null
  const now = Date.now()
  const diff = Math.max(0, now - ms)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function XmtpStatus({ sent, resolutionSent }) {
  if (resolutionSent) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-green-400">
        <MessageSquare className="h-3 w-3" aria-hidden="true" />
        XMTP resolved
      </span>
    )
  }
  if (sent) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-yellow-300">
        <MessageSquare className="h-3 w-3" aria-hidden="true" />
        XMTP alert sent
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-neutral-600">
      <MessageSquare className="h-3 w-3" aria-hidden="true" />
      XMTP not sent
    </span>
  )
}

function PendingRow({
  approval,
  agents,
  services,
  onApprove,
  onDeny,
  approvalsInteractive,
}) {
  const [acting, setActing] = useState(null)
  const agent = agents.find((a) => a.id === approval.agentId)
  const service = services.find(
    (s) => s.serviceId === approval.serviceId || s.vendorId === approval.vendorId,
  )

  async function handle(decision, action) {
    setActing(decision)
    try {
      await action(approval.id)
    } finally {
      // pending state will resolve when the approval disappears from the list
      // but reset locally in case the call throws
      setActing(null)
    }
  }

  return (
    <article className="border border-yellow-500/30 bg-yellow-500/5 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5 text-yellow-300" aria-hidden="true" />
            <span className="text-[10px] uppercase tracking-widest text-yellow-300">
              approval required
            </span>
          </div>
          <h3 className="line-clamp-2 text-base font-medium text-white">
            {approval.action}
          </h3>
          {approval.reason && (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-400">
              {approval.reason}
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-neutral-500">
            Amount
          </div>
          <div className="mt-1 font-mono text-lg text-yellow-200">
            {formatPusd(approval.amount)} PUSD
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 border-t border-yellow-500/20 pt-3 text-[11px] sm:grid-cols-3">
        <button
          type="button"
          onClick={() => agent && navigate(`#dashboard/agents/${agent.id}`)}
          disabled={!agent}
          className="flex min-w-0 items-center gap-1 truncate text-left text-neutral-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-default disabled:hover:text-neutral-400"
        >
          <span className="text-neutral-700">Agent:</span>
          <span className="truncate">{approval.agentName}</span>
        </button>
        <button
          type="button"
          onClick={() => service && navigate(`#dashboard/services/${service.serviceId}`)}
          disabled={!service}
          className="flex min-w-0 items-center gap-1 truncate text-left text-neutral-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-default disabled:hover:text-neutral-400"
        >
          <span className="text-neutral-700">Service:</span>
          <span className="truncate">{service?.label ?? approval.vendor}</span>
        </button>
        <div className="flex items-center justify-end gap-3 text-neutral-500">
          <XmtpStatus sent={approval.xmtpSent} />
          <span className="font-mono">{relativeTimestamp(approval.createdAt)}</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!approvalsInteractive || acting !== null}
          onClick={() => handle('approve', onApprove)}
          className="min-h-10 border border-green-500/30 bg-green-500/10 px-3 text-xs font-medium uppercase tracking-widest text-green-400 transition-colors hover:bg-green-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {acting === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          disabled={!approvalsInteractive || acting !== null}
          onClick={() => handle('deny', onDeny)}
          className="min-h-10 border border-red-500/30 bg-red-500/10 px-3 text-xs font-medium uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {acting === 'deny' ? 'Denying…' : 'Deny'}
        </button>
      </div>
    </article>
  )
}

function HistoryRow({ event, services }) {
  const service = services.find((s) => s.serviceId === event.serviceId)
  const serviceLabel = service?.label ?? event.serviceId ?? event.vendor

  let outcomeLabel
  let outcomeTone
  if (event.result === 'approved') {
    outcomeLabel = event.approvedByOperator ? 'Approved by operator' : 'Approved'
    outcomeTone =
      'border-green-500/30 bg-green-500/5 text-green-400'
  } else if (event.status === 'blocked') {
    outcomeLabel = 'Blocked'
    outcomeTone = 'border-red-500/30 bg-red-500/5 text-red-400'
  } else {
    outcomeLabel = 'Denied'
    outcomeTone = 'border-red-500/30 bg-red-500/5 text-red-400'
  }

  return (
    <button
      type="button"
      onClick={() => navigate(`#dashboard/transactions/${event.id}`)}
      className="flex w-full flex-col gap-2 border border-neutral-800 bg-neutral-950 p-4 text-left transition-colors hover:border-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white sm:flex-row sm:items-center"
    >
      <span
        className={`shrink-0 inline-flex items-center border px-2 py-1 text-[10px] uppercase tracking-widest ${outcomeTone}`}
      >
        {outcomeLabel}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <div className="truncate text-neutral-300">{serviceLabel}</div>
        <div className="mt-0.5 truncate text-[11px] text-neutral-500">
          {event.agentName} ·{' '}
          <span className="font-mono">{formatPusd(event.amount)} PUSD</span>
          {event.xmtpResolutionSent && ' · XMTP resolved'}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-[11px] text-neutral-500">
        <span className="font-mono">{relativeTimestamp(event.atMs)}</span>
        <ArrowRight className="h-3.5 w-3.5 text-neutral-600" aria-hidden="true" />
      </div>
    </button>
  )
}

export default function ApprovalsPage({
  pendingApprovals,
  events,
  agents,
  services,
  onApprove,
  onDeny,
  approvalsInteractive,
}) {
  const history = events.filter(
    (event) =>
      event.type === 'spend' &&
      event.requiredApproval &&
      event.status !== 'approval_pending' &&
      event.status !== 'waiting_for_execution',
  )

  const totalPending = pendingApprovals.reduce(
    (sum, approval) => sum + (approval.amount ?? 0),
    0,
  )
  const xmtpSentCount = pendingApprovals.filter((a) => a.xmtpSent).length

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-800 px-6 py-5">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-600">
            Approvals
          </div>
          <h1 className="mt-1 text-xl font-medium text-white">
            {pendingApprovals.length} pending ·{' '}
            <span className="font-mono text-neutral-400">
              {formatPusd(totalPending)} PUSD
            </span>{' '}
            queued
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="border border-neutral-800 bg-neutral-900 px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-widest text-neutral-500">
              XMTP alerted
            </span>
            <span className="ml-2 font-mono text-xs text-yellow-300">
              {xmtpSentCount}
            </span>
          </div>
          <div className="border border-neutral-800 bg-neutral-900 px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-widest text-neutral-500">
              Resolved history
            </span>
            <span className="ml-2 font-mono text-xs text-white">{history.length}</span>
          </div>
        </div>
      </div>

      <div className="space-y-8 px-6 py-6">
        <section>
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-[10px] uppercase tracking-widest text-neutral-500">
              Pending
            </h2>
            <span className="font-mono text-xs text-neutral-600">
              {pendingApprovals.length}
            </span>
            {!approvalsInteractive && pendingApprovals.length > 0 && (
              <span className="ml-2 text-[10px] uppercase tracking-widest text-neutral-700">
                · waiting for sync
              </span>
            )}
          </div>
          {pendingApprovals.length === 0 ? (
            <div className="border border-dashed border-neutral-800 px-6 py-12 text-center">
              <p className="text-sm text-neutral-400">No payments need approval.</p>
              <p className="mt-1 text-[11px] uppercase tracking-widest text-neutral-700">
                Approval-required spends queue here when an agent exceeds its
                auto-approve threshold.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {pendingApprovals.map((approval) => (
                <li key={approval.id}>
                  <PendingRow
                    approval={approval}
                    agents={agents}
                    services={services}
                    onApprove={onApprove}
                    onDeny={onDeny}
                    approvalsInteractive={approvalsInteractive}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-[10px] uppercase tracking-widest text-neutral-500">
              Resolved history
            </h2>
            <span className="font-mono text-xs text-neutral-600">{history.length}</span>
          </div>
          {history.length === 0 ? (
            <div className="border border-dashed border-neutral-800 px-6 py-8 text-center">
              <p className="text-sm text-neutral-500">
                No approval-required calls have been resolved yet.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {history.map((event) => (
                <li key={event.id}>
                  <HistoryRow event={event} services={services} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
