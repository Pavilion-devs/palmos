import { Plus } from 'lucide-react'
import useNow from '../../hooks/useNow'

const STATUS_STYLES = {
  active: { dot: 'bg-green-500', label: 'ACTIVE', text: 'text-green-400' },
  pending: { dot: 'bg-yellow-500 animate-pulse', label: 'PENDING', text: 'text-yellow-400' },
  denied: { dot: 'bg-red-500', label: 'DENIED', text: 'text-red-400' },
  blocked: { dot: 'bg-red-500', label: 'BLOCKED', text: 'text-red-400' },
  idle: { dot: 'bg-neutral-600', label: 'IDLE', text: 'text-neutral-500' },
  revoked: { dot: 'bg-red-500', label: 'REVOKED', text: 'text-red-400' },
}

const TRUST_STYLES = {
  trusted: 'text-green-400',
  healthy: 'text-blue-400',
  new: 'text-neutral-400',
}

function formatPusd(value, digits = 3) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '0.000'
}

function DeadManTimer({ lastCheckIn, deadManSeconds }) {
  const now = useNow(1000)
  const elapsed = lastCheckIn ? Math.floor((now - lastCheckIn) / 1000) : 0

  if (!lastCheckIn) {
    const mins = Math.floor(deadManSeconds / 60)
    const secs = deadManSeconds % 60
    return (
      <span className="font-mono text-[10px] text-neutral-700">
        DMS {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')} standby
      </span>
    )
  }

  const remaining = Math.max(0, deadManSeconds - elapsed)
  const mins = Math.floor(remaining / 60)
  const secs = Math.floor(remaining % 60)
  const isLow = remaining < 60
  const isExpired = remaining === 0
  return (
    <span className={`font-mono text-[10px] ${isExpired ? 'text-red-500 font-medium' : isLow ? 'text-red-400' : 'text-neutral-600'}`}>
      DMS {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}{' '}
      <span className="text-neutral-700">({elapsed}s ago)</span>
    </span>
  )
}

export default function AgentSidebar({
  agents,
  selectedAgentId,
  onSelectAgent,
  onCreateAgent,
}) {
  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-600">
          Agent Registry
        </span>
        {onCreateAgent && (
          <button
            type="button"
            onClick={onCreateAgent}
            className="flex items-center gap-1 border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] uppercase tracking-widest text-neutral-300 transition-colors hover:border-white hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            New
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {agents.length === 0 && (
          <div className="px-4 py-5">
            <p className="text-xs text-neutral-500">No agents registered yet.</p>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-neutral-700">
              Run onboarding to create one.
            </p>
          </div>
        )}
        {agents.map((agent) => {
          const statusStyle = STATUS_STYLES[agent.status] || STATUS_STYLES.idle
          const isSelected = agent.id === selectedAgentId
          const budgetPercent = agent.budgetTotal > 0 ? (agent.budgetUsed / agent.budgetTotal) * 100 : 0
          const budgetDanger = budgetPercent >= 90
          const budgetWarn = budgetPercent >= 70

          return (
            <button
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              className={`w-full border-b border-neutral-800/50 px-4 py-4 text-left transition-colors ${
                isSelected ? 'bg-neutral-900' : 'hover:bg-neutral-900/50'
              }`}
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center border border-neutral-700 bg-neutral-800 font-mono text-xs font-medium text-neutral-300">
                  {agent.letter}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">{agent.name}</div>
                  <div className="flex items-center gap-1.5">
                    <div className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
                    <span className={`text-[10px] uppercase tracking-wider ${statusStyle.text}`}>
                      {statusStyle.label}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-lg font-medium text-white">
                  {formatPusd(agent.balance)} PUSD
                </span>
                <span className={`text-[10px] uppercase tracking-wider ${TRUST_STYLES[agent.trustTier] || 'text-neutral-400'}`}>
                  {agent.trustTier}
                </span>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-neutral-700">
                  {agent.policy?.walletBackend === 'ows' ? 'OWS-backed wallet' : 'Payment profile'}
                </span>
                <span className="border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-neutral-400">
                  {agent.policy?.walletBackend === 'ows' ? 'OWS' : 'TEST'}
                </span>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-neutral-700">
                  Portfolio
                </span>
                <span className="font-mono text-[10px] text-neutral-400">
                  PUSD ready
                </span>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-neutral-700">
                  Activity
                </span>
                <span className="font-mono text-[10px] text-neutral-500">
                  {agent.policy?.walletState ?? 'unknown'}
                </span>
              </div>

              {/* Budget bar */}
              <div className="mb-2">
                <div className="h-1 w-full bg-neutral-800">
                  <div
                    className={`h-full transition-all duration-500 ${
                      budgetDanger
                        ? 'bg-red-400'
                        : budgetWarn
                          ? 'bg-yellow-400'
                          : 'bg-neutral-500'
                    }`}
                    style={{ width: `${Math.min(100, budgetPercent)}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-neutral-600">
                    {formatPusd(agent.budgetUsed)} / {formatPusd(agent.budgetTotal, 2)} PUSD
                  </span>
                  <span className="font-mono text-[10px] uppercase text-neutral-700">{agent.chain}</span>
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-widest text-neutral-700">
                  session budget
                </div>
              </div>

              <DeadManTimer lastCheckIn={agent.lastCheckIn} deadManSeconds={agent.deadManSeconds} />
            </button>
          )
        })}
      </div>
    </aside>
  )
}
