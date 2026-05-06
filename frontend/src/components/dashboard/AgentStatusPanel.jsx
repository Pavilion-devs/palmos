import { AlertTriangle, CheckCircle2, Clock3, ShieldCheck } from 'lucide-react'

const STATUS_COPY = {
  active: {
    label: 'Ready',
    tone: 'text-green-400',
    icon: CheckCircle2,
  },
  pending: {
    label: 'Approval pending',
    tone: 'text-yellow-400',
    icon: Clock3,
  },
  blocked: {
    label: 'Blocked',
    tone: 'text-red-400',
    icon: AlertTriangle,
  },
  revoked: {
    label: 'Revoked',
    tone: 'text-red-400',
    icon: AlertTriangle,
  },
  denied: {
    label: 'Denied',
    tone: 'text-red-400',
    icon: AlertTriangle,
  },
  idle: {
    label: 'Idle',
    tone: 'text-neutral-500',
    icon: ShieldCheck,
  },
}

function formatPusd(value, digits = 3) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '0.000'
}

function getBudgetTone(percent) {
  if (percent >= 100) {
    return 'bg-red-400'
  }

  if (percent >= 70) {
    return 'bg-yellow-400'
  }

  return 'bg-white'
}

export default function AgentStatusPanel({ agent }) {
  if (!agent) {
    return (
      <section className="border-b border-neutral-800 bg-black px-5 py-4">
        <div className="border border-neutral-900 px-4 py-5">
          <p className="text-sm text-neutral-500">No agent policy loaded.</p>
          <p className="mt-1 text-xs text-neutral-700">Run the worker to load backend policy state.</p>
        </div>
      </section>
    )
  }

  const status = STATUS_COPY[agent.status] ?? STATUS_COPY.idle
  const Icon = status.icon
  const policy = agent.policy ?? {}
  const budgetPercent = policy.sessionBudget
    ? Math.min(100, (policy.sessionSpent / policy.sessionBudget) * 100)
    : 0
  const vendorPreview = policy.vendors?.slice(0, 2).join(', ') || 'No vendors'
  const extraVendorCount = Math.max(0, (policy.vendors?.length ?? 0) - 2)

  return (
    <section className="border-b border-neutral-800 bg-black px-5 py-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
        <div className="border border-neutral-900 bg-neutral-950/60 p-4">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <Icon className={`h-4 w-4 ${status.tone}`} aria-hidden="true" />
                <span className={`text-[10px] uppercase tracking-widest ${status.tone}`}>
                  {status.label}
                </span>
              </div>
              <h2 className="truncate text-lg font-medium text-white">{agent.name}</h2>
              <p className="mt-1 truncate text-xs text-neutral-500">
                {policy.walletBackend === 'ows' ? 'OWS wallet' : 'Runtime wallet'} / {policy.walletState ?? 'unknown'} / {agent.chain}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono text-2xl font-medium text-white">
                {formatPusd(policy.sessionRemaining)}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-neutral-600">
                PUSD remaining
              </div>
            </div>
          </div>

          <div className="mb-3 h-1.5 w-full bg-neutral-800">
            <div
              className={`h-full transition-all duration-500 ${getBudgetTone(budgetPercent)}`}
              style={{ width: `${budgetPercent}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Session" value={`${formatPusd(policy.sessionSpent)} / ${formatPusd(policy.sessionBudget, 2)}`} />
            <Metric label="Max call" value={`${formatPusd(policy.maxPerCall, 2)} PUSD`} />
            <Metric label="Auto approve" value={`${formatPusd(policy.autoApproveMax, 2)} PUSD`} />
            <Metric label="Blocked" value={String(policy.blockedCount ?? 0)} warn={Boolean(policy.blockedCount)} />
          </div>
        </div>

        <div className="border border-neutral-900 bg-neutral-950/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[10px] uppercase tracking-widest text-neutral-600">
              Latest outcome
            </span>
            <span className="font-mono text-[10px] uppercase text-neutral-500">
              {policy.latestAmount != null ? `${formatPusd(policy.latestAmount)} PUSD` : 'no call'}
            </span>
          </div>
          <p className={`text-sm font-medium ${policy.latestErrorCode ? 'text-red-300' : 'text-white'}`}>
            {policy.latestErrorCode ?? policy.latestOutcome ?? 'No paid calls yet'}
          </p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-500">
            {policy.latestReason || `${vendorPreview}${extraVendorCount ? ` +${extraVendorCount} more` : ''}`}
          </p>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-900 pt-3">
            <span className="truncate text-[10px] uppercase tracking-widest text-neutral-700">
              {vendorPreview}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-neutral-500">
              {policy.xmtpAlertCount ?? 0} XMTP
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

function Metric({ label, value, warn = false }) {
  return (
    <div className="min-w-0 border-l border-neutral-900 pl-3">
      <div className="text-[10px] uppercase tracking-widest text-neutral-700">{label}</div>
      <div className={`mt-1 truncate font-mono text-xs ${warn ? 'text-red-300' : 'text-neutral-300'}`}>
        {value}
      </div>
    </div>
  )
}
