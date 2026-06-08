import {
  AlertTriangle,
  CircleDollarSign,
  Clock3,
  DatabaseZap,
  ShieldCheck,
} from 'lucide-react'
import { navigate } from '../../hooks/useHashRoute'

const STATUS_TONE = {
  active: 'text-green-400',
  pending: 'text-yellow-400',
  blocked: 'text-red-400',
  revoked: 'text-red-400',
  denied: 'text-red-400',
  idle: 'text-neutral-500',
}

function formatPusd(value, digits = 3) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '0.000'
}

function EmptyLane({ label }) {
  return (
    <div className="border border-dashed border-neutral-800 px-4 py-6">
      <p className="text-sm text-neutral-500">{label}</p>
    </div>
  )
}

function Lane({ title, count, icon, children }) {
  const LaneIcon = icon
  return (
    <section className="flex h-full w-[320px] shrink-0 flex-col border border-neutral-800 bg-neutral-950/60 sm:w-[360px]">
      <div className="flex min-h-14 items-center justify-between border-b border-neutral-800 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <LaneIcon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
          <h2 className="truncate text-sm font-medium text-white">{title}</h2>
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-400">
            {count}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">{children}</div>
    </section>
  )
}

function BoardButton({ onClick, tone = 'neutral', children }) {
  const toneHover =
    tone === 'yellow'
      ? 'hover:border-yellow-500/50'
      : tone === 'red'
        ? 'hover:border-red-500/50'
        : tone === 'green'
          ? 'hover:border-green-500/50'
          : 'hover:border-neutral-600'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-36 w-full border border-neutral-800 bg-neutral-950 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${toneHover}`}
    >
      {children}
    </button>
  )
}

function MiniMetric({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-neutral-700">{label}</div>
      <div className="mt-1 truncate font-mono text-xs text-neutral-400">{value}</div>
    </div>
  )
}

function AgentCard({ agent }) {
  const budgetPercent = agent.budgetTotal
    ? Math.min(100, (agent.budgetUsed / agent.budgetTotal) * 100)
    : 0
  const statusTone = STATUS_TONE[agent.status] ?? STATUS_TONE.idle

  return (
    <BoardButton onClick={() => navigate(`#dashboard/agents/${agent.id}`)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full bg-current ${statusTone}`} />
            <span className={`text-[10px] uppercase tracking-widest ${statusTone}`}>
              {agent.status}
            </span>
          </div>
          <h3 className="line-clamp-2 text-base font-medium text-white">{agent.name}</h3>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-neutral-700 bg-neutral-900 font-mono text-sm text-neutral-300">
          {agent.letter}
        </div>
      </div>
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-neutral-600">Session</span>
          <span className="font-mono text-xs text-neutral-400">
            {formatPusd(agent.budgetUsed)} / {formatPusd(agent.budgetTotal, 2)}
          </span>
        </div>
        <div className="h-1.5 bg-neutral-800">
          <div className="h-full bg-white" style={{ width: `${budgetPercent}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-neutral-900 pt-3">
        <MiniMetric label="Max" value={`${formatPusd(agent.policy?.maxPerCall, 2)} PUSD`} />
        <MiniMetric label="Services" value={String(agent.policy?.vendors?.length ?? 0)} />
      </div>
    </BoardButton>
  )
}

function ApprovalCard({ approval, onApprove, onDeny, approvalsInteractive }) {
  return (
    <article className="min-h-36 border border-neutral-800 bg-neutral-950 p-4 transition-colors hover:border-yellow-500/50">
      <button
        type="button"
        onClick={() => navigate('#dashboard/approvals')}
        className="-m-1 block w-[calc(100%+0.5rem)] p-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-2.5 py-1 text-[10px] uppercase tracking-widest text-yellow-300">
            approval
          </span>
          <span className="font-mono text-xs text-yellow-300">
            {formatPusd(approval.amount)} PUSD
          </span>
        </div>
        <h3 className="line-clamp-2 text-base font-medium text-white">{approval.action}</h3>
        <p className="mt-2 line-clamp-2 text-sm leading-5 text-neutral-500">{approval.reason}</p>
        <div className="mt-4 flex items-center justify-between border-t border-neutral-900 pt-3">
          <span className="truncate text-xs text-neutral-500">{approval.agentName}</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-600">
            {approval.xmtpSent ? 'XMTP sent' : 'dashboard'}
          </span>
        </div>
      </button>
      {onApprove && onDeny && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!approvalsInteractive}
            onClick={() => onApprove(approval.id)}
            className="min-h-10 border border-green-500/30 bg-green-500/10 px-3 text-xs font-medium uppercase tracking-widest text-green-400 transition-colors hover:bg-green-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={!approvalsInteractive}
            onClick={() => onDeny(approval.id)}
            className="min-h-10 border border-red-500/30 bg-red-500/10 px-3 text-xs font-medium uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Deny
          </button>
        </div>
      )}
    </article>
  )
}

function ServiceCard({ service }) {
  return (
    <BoardButton onClick={() => navigate(`#dashboard/services/${service.serviceId}`)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[10px] uppercase tracking-widest text-neutral-400">
          {service.source === 'registered' ? 'registered' : 'built-in'}
        </span>
        <span className="font-mono text-xs text-white">{service.expectedAmount} PUSD</span>
      </div>
      <h3 className="line-clamp-2 text-base font-medium text-white">{service.label}</h3>
      <p className="mt-2 truncate font-mono text-xs text-neutral-500">{service.serviceId}</p>
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-neutral-900 pt-3">
        <MiniMetric label="Vendor" value={service.vendorId} />
        <MiniMetric label="Chain" value={service.chainId} />
      </div>
    </BoardButton>
  )
}

function PaymentCard({ event }) {
  const tone = event.result === 'approved' ? 'green' : event.result === 'pending' ? 'yellow' : 'red'
  const isNativeWalletAction =
    event.transactionKind === 'native_wallet_action' ||
    Boolean(event.actionRequestKind)
  const target = isNativeWalletAction
    ? `#dashboard/wallet-actions/${event.id}`
    : `#dashboard/transactions/${event.id}`

  return (
    <BoardButton
      tone={tone}
      onClick={() => navigate(target)}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[10px] uppercase tracking-widest text-neutral-400">
          {event.badgeLabel ?? event.result}
        </span>
        <span className="font-mono text-xs text-white">
          {event.amount != null ? `${formatPusd(event.amount)} PUSD` : 'event'}
        </span>
      </div>
      <h3 className="line-clamp-2 text-base font-medium text-white">{event.action}</h3>
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-neutral-500">{event.reason}</p>
      <div className="mt-4 flex items-center justify-between border-t border-neutral-900 pt-3">
        <span className="truncate text-xs text-neutral-500">{event.agentName}</span>
        <span className="font-mono text-[10px] text-neutral-600">{event.timestamp}</span>
      </div>
    </BoardButton>
  )
}

function AuditCard({ event }) {
  const target =
    event.type === 'xmtp' ? '#dashboard/approvals' : '#dashboard/transactions'
  return (
    <BoardButton onClick={() => navigate(target)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[10px] uppercase tracking-widest text-neutral-400">
          {event.type}
        </span>
        <span className="font-mono text-xs text-neutral-500">{event.timestamp}</span>
      </div>
      <h3 className="line-clamp-2 text-base font-medium text-white">{event.action}</h3>
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-neutral-500">{event.reason}</p>
    </BoardButton>
  )
}

export default function OperationsBoard({
  agents,
  services,
  events,
  pendingApprovals,
  onApprove,
  onDeny,
  approvalsInteractive,
}) {
  const payments = events.filter((event) => event.type === 'spend').slice(0, 12)
  const auditEvents = events.filter((event) => event.type !== 'spend').slice(0, 12)

  return (
    <div className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-black">
      <div className="flex min-w-max gap-4 p-5">
        <Lane title="Agents" count={agents.length} icon={ShieldCheck}>
          {agents.length === 0 ? (
            <EmptyLane label="No agents registered yet. Run onboarding to create one." />
          ) : (
            agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)
          )}
        </Lane>

        <Lane title="Approvals" count={pendingApprovals.length} icon={Clock3}>
          {pendingApprovals.length === 0 ? (
            <EmptyLane label="No payments need approval." />
          ) : (
            pendingApprovals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onApprove={onApprove}
                onDeny={onDeny}
                approvalsInteractive={approvalsInteractive}
              />
            ))
          )}
        </Lane>

        <Lane title="Services" count={services.length} icon={DatabaseZap}>
          {services.length === 0 ? (
            <EmptyLane label="No paid services registered yet." />
          ) : (
            services.map((service) => (
              <ServiceCard key={service.serviceId} service={service} />
            ))
          )}
        </Lane>

        <Lane title="Payments" count={payments.length} icon={CircleDollarSign}>
          {payments.length === 0 ? (
            <EmptyLane label="No paid calls recorded." />
          ) : (
            payments.map((event) => <PaymentCard key={event.id} event={event} />)
          )}
        </Lane>

        <Lane title="Audit" count={auditEvents.length} icon={AlertTriangle}>
          {auditEvents.length === 0 ? (
            <EmptyLane label="No policy or XMTP audit events yet." />
          ) : (
            auditEvents.map((event) => <AuditCard key={event.id} event={event} />)
          )}
        </Lane>
      </div>
    </div>
  )
}
