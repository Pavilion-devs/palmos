import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  DatabaseZap,
  KeyRound,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'
import { useMemo, useState } from 'react'

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

function compactAddress(value) {
  if (!value) {
    return 'not set'
  }

  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

function EmptyLane({ label }) {
  return (
    <div className="border border-dashed border-neutral-800 px-4 py-6">
      <p className="text-sm text-neutral-500">{label}</p>
    </div>
  )
}

function Lane({ title, count, icon: Icon, children }) {
  return (
    <section className="flex h-full w-[360px] shrink-0 flex-col border border-neutral-800 bg-neutral-950/60">
      <div className="flex min-h-14 items-center justify-between border-b border-neutral-800 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
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

function BoardCard({ children, selected, onClick, tone = 'neutral' }) {
  const toneClass =
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
      className={`min-h-36 w-full border bg-neutral-950 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${
        selected ? 'border-white' : `border-neutral-800 ${toneClass}`
      }`}
    >
      {children}
    </button>
  )
}

function AgentCard({ agent, selected, onClick }) {
  const budgetPercent = agent.budgetTotal
    ? Math.min(100, (agent.budgetUsed / agent.budgetTotal) * 100)
    : 0
  const statusTone = STATUS_TONE[agent.status] ?? STATUS_TONE.idle

  return (
    <BoardCard selected={selected} onClick={onClick}>
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
    </BoardCard>
  )
}

function ApprovalCard({ approval, selected, onClick }) {
  return (
    <BoardCard selected={selected} onClick={onClick} tone="yellow">
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
    </BoardCard>
  )
}

function ServiceCard({ service, selected, onClick }) {
  return (
    <BoardCard selected={selected} onClick={onClick}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[10px] uppercase tracking-widest text-neutral-400">
          {service.source === 'registered' ? 'registered' : 'built in'}
        </span>
        <span className="font-mono text-xs text-white">{service.expectedAmount} PUSD</span>
      </div>
      <h3 className="line-clamp-2 text-base font-medium text-white">{service.label}</h3>
      <p className="mt-2 truncate font-mono text-xs text-neutral-500">{service.serviceId}</p>
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-neutral-900 pt-3">
        <MiniMetric label="Vendor" value={service.vendorId} />
        <MiniMetric label="Chain" value={service.chainId} />
      </div>
    </BoardCard>
  )
}

function PaymentCard({ event, selected, onClick }) {
  const tone = event.result === 'approved' ? 'green' : event.result === 'pending' ? 'yellow' : 'red'

  return (
    <BoardCard selected={selected} onClick={onClick} tone={tone}>
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
    </BoardCard>
  )
}

function AuditCard({ event, selected, onClick }) {
  return (
    <BoardCard selected={selected} onClick={onClick}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[10px] uppercase tracking-widest text-neutral-400">
          {event.type}
        </span>
        <span className="font-mono text-xs text-neutral-500">{event.timestamp}</span>
      </div>
      <h3 className="line-clamp-2 text-base font-medium text-white">{event.action}</h3>
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-neutral-500">{event.reason}</p>
    </BoardCard>
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

function DetailRow({ label, value }) {
  return (
    <div className="border-b border-neutral-900 py-3">
      <div className="text-[10px] uppercase tracking-widest text-neutral-700">{label}</div>
      <div className="mt-1 break-words text-sm text-neutral-300">{value ?? 'n/a'}</div>
    </div>
  )
}

function Inspector({ selection, agents, services }) {
  if (!selection) {
    return (
      <aside className="hidden w-[340px] shrink-0 border-l border-neutral-800 bg-neutral-950 px-5 py-5 xl:block">
        <p className="text-sm text-neutral-500">Select a card to inspect policy, payment, or service details.</p>
      </aside>
    )
  }

  const item = selection.item

  return (
    <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950 px-5 py-5 xl:block">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-neutral-600">
            {selection.type}
          </div>
          <h2 className="mt-2 line-clamp-2 text-lg font-medium text-white">
            {item.name ?? item.label ?? item.action ?? item.serviceId}
          </h2>
        </div>
      </div>

      {selection.type === 'agent' && (
        <>
          <DetailRow label="Wallet" value={item.policy?.owsWalletName} />
          <DetailRow label="Wallet state" value={item.policy?.walletState} />
          <DetailRow label="Budget remaining" value={`${formatPusd(item.policy?.sessionRemaining)} PUSD`} />
          <DetailRow label="Max per call" value={`${formatPusd(item.policy?.maxPerCall, 2)} PUSD`} />
          <DetailRow label="Auto approve" value={`${formatPusd(item.policy?.autoApproveMax, 2)} PUSD`} />
          <DetailRow label="Allowed services" value={(item.policy?.vendors ?? []).join(', ') || 'none'} />
          <DetailRow label="SDK key" value={item.policy?.apiKeyId} />
        </>
      )}

      {selection.type === 'approval' && (
        <>
          <DetailRow label="Agent" value={item.agentName} />
          <DetailRow label="Amount" value={`${formatPusd(item.amount)} PUSD`} />
          <DetailRow label="Service" value={item.vendor} />
          <DetailRow label="Reason" value={item.reason} />
          <DetailRow label="XMTP" value={item.xmtpSent ? 'sent' : 'not sent'} />
        </>
      )}

      {selection.type === 'service' && (
        <>
          <DetailRow label="Service id" value={item.serviceId} />
          <DetailRow label="Vendor" value={item.vendorId} />
          <DetailRow label="Price" value={`${item.expectedAmount} PUSD`} />
          <DetailRow label="Chain" value={item.chainId} />
          <DetailRow label="Endpoint" value={item.registered?.endpointUrl ?? 'built-in service'} />
          <DetailRow label="Recipient" value={compactAddress(item.registered?.destinationAddress)} />
        </>
      )}

      {selection.type === 'payment' && (
        <>
          <DetailRow label="Agent" value={item.agentName} />
          <DetailRow label="Amount" value={item.amount != null ? `${formatPusd(item.amount)} PUSD` : 'n/a'} />
          <DetailRow label="Status" value={item.status} />
          <DetailRow label="Vendor" value={item.vendor} />
          <DetailRow label="Transaction" value={item.txHashFull ?? item.txHash ?? 'local receipt pending'} />
          <DetailRow label="Policy reason" value={item.reason} />
        </>
      )}

      {selection.type === 'audit' && (
        <>
          <DetailRow label="Agent" value={item.agentName} />
          <DetailRow label="Type" value={item.type} />
          <DetailRow label="Outcome" value={item.result} />
          <DetailRow label="Detail" value={item.reason} />
          <DetailRow label="At" value={item.timestamp} />
        </>
      )}

      <div className="mt-6 border border-neutral-900 bg-black p-4">
        <div className="mb-2 flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5 text-neutral-500" aria-hidden="true" />
          <span className="text-[10px] uppercase tracking-widest text-neutral-600">
            SDK command
          </span>
        </div>
        <code className="block whitespace-pre-wrap break-all font-mono text-xs leading-5 text-neutral-400">
          PALMOS_AGENT_TOKEN=palmos_... npm run agent:external
        </code>
      </div>

      <div className="mt-6 text-[10px] uppercase tracking-widest text-neutral-700">
        {agents.length} agents / {services.length} services
      </div>
    </aside>
  )
}

export default function OperationsBoard({
  agents,
  services,
  events,
  pendingApprovals,
  totalSpent,
  pendingCount,
  focusedAgent,
  selectedAgentId,
  onSelectAgent,
}) {
  const [selection, setSelection] = useState(() =>
    focusedAgent ? { type: 'agent', id: focusedAgent.id, item: focusedAgent } : null,
  )

  const payments = useMemo(
    () => events.filter((event) => event.type === 'spend').slice(0, 12),
    [events],
  )
  const auditEvents = useMemo(
    () => events.filter((event) => event.type !== 'spend').slice(0, 12),
    [events],
  )

  function select(type, id, item) {
    setSelection({ type, id, item })
    if (type === 'agent') {
      onSelectAgent(id)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 bg-black">
      <main className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-5">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-neutral-600">
              Command board
            </div>
            <h1 className="mt-1 text-xl font-medium text-white">PalmOS Operations</h1>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <BoardStat icon={WalletCards} label="Agents" value={String(agents.length)} />
            <BoardStat icon={CircleDollarSign} label="Spent" value={`${formatPusd(totalSpent)} PUSD`} />
            <BoardStat icon={Clock3} label="Pending" value={String(pendingCount)} />
          </div>
        </div>

        <div className="h-full overflow-x-auto px-6 py-5">
          <div className="flex h-[calc(100vh-190px)] min-w-max gap-4 pb-4">
            <Lane title="Agents" count={agents.length} icon={ShieldCheck}>
              {agents.length === 0 ? (
                <EmptyLane label="No agents are registered yet." />
              ) : (
                agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    selected={selection?.type === 'agent' && selection.id === agent.id}
                    onClick={() => select('agent', agent.id, agent)}
                  />
                ))
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
                    selected={selection?.type === 'approval' && selection.id === approval.id}
                    onClick={() => select('approval', approval.id, approval)}
                  />
                ))
              )}
            </Lane>

            <Lane title="Services" count={services.length} icon={DatabaseZap}>
              {services.length === 0 ? (
                <EmptyLane label="No paid services are registered." />
              ) : (
                services.map((service) => (
                  <ServiceCard
                    key={service.serviceId}
                    service={service}
                    selected={selection?.type === 'service' && selection.id === service.serviceId}
                    onClick={() => select('service', service.serviceId, service)}
                  />
                ))
              )}
            </Lane>

            <Lane title="Payments" count={payments.length} icon={CircleDollarSign}>
              {payments.length === 0 ? (
                <EmptyLane label="No paid calls recorded." />
              ) : (
                payments.map((event) => (
                  <PaymentCard
                    key={event.id}
                    event={event}
                    selected={selection?.type === 'payment' && selection.id === event.id}
                    onClick={() => select('payment', event.id, event)}
                  />
                ))
              )}
            </Lane>

            <Lane title="Audit" count={auditEvents.length} icon={AlertTriangle}>
              {auditEvents.length === 0 ? (
                <EmptyLane label="No non-payment audit events yet." />
              ) : (
                auditEvents.map((event) => (
                  <AuditCard
                    key={event.id}
                    event={event}
                    selected={selection?.type === 'audit' && selection.id === event.id}
                    onClick={() => select('audit', event.id, event)}
                  />
                ))
              )}
            </Lane>
          </div>
        </div>
      </main>
      <Inspector selection={selection} agents={agents} services={services} />
    </div>
  )
}

function BoardStat({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-neutral-600" aria-hidden="true" />
      <span className="text-[10px] uppercase tracking-widest text-neutral-600">{label}</span>
      <span className="font-mono text-sm text-white">{value}</span>
    </div>
  )
}
