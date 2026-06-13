import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Gauge, Boxes, Coins, Bot } from 'lucide-react'

const statusStyles = {
  active: 'bg-lime/15 text-lime',
  pending: 'bg-pending/15 text-pending',
  blocked: 'bg-blocked/15 text-blocked',
}

const railIcons = {
  limit: Gauge,
  chain: Boxes,
  asset: Coins,
  privacy: Lock,
}

const tabs = ['All Wallets', 'Flagged', 'Managed']

function RailChip({ rail }) {
  const Icon = railIcons[rail.type] ?? Coins
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-panel-2 px-2.5 py-1 text-xs font-medium text-foreground">
      <Icon className="size-3.5 text-muted-foreground" strokeWidth={2} aria-hidden="true" />
      {rail.label}
    </span>
  )
}

export function WalletsTable({ status, rows, error }) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('All Wallets')

  const filtered = rows.filter((w) => {
    if (activeTab === 'Flagged') return w.tone !== 'active'
    if (activeTab === 'Managed') return w.tone === 'active'
    return true
  })

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-3xl bg-panel p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Wallets</h2>
        <div className="flex items-center gap-1 rounded-full bg-panel-2 p-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-lime text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Column headers */}
      <div className="mt-6 hidden grid-cols-[1.6fr_1fr_2.4fr_1fr_auto] items-center gap-4 px-2 pb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground lg:grid">
        <span>Wallet</span>
        <span>Value</span>
        <span>Rails</span>
        <span>Status</span>
        <span className="sr-only">Open</span>
      </div>

      {/* Rows */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {status === 'loading' && (
          <div className="px-2 py-10 text-center text-sm text-muted-foreground">
            Loading wallets…
          </div>
        )}
        {status === 'error' && (
          <div className="px-2 py-10 text-center text-sm text-blocked">
            {error || 'Unable to load wallets.'}
          </div>
        )}
        {status === 'ready' && filtered.length === 0 && (
          <div className="px-2 py-10 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? 'No agent wallets yet. Connect an agent to provision its first wallet.'
              : 'No wallets match this filter.'}
          </div>
        )}
        {filtered.map((w, i) => (
          <div
            key={w.agentId}
            className={`grid grid-cols-1 items-center gap-4 px-2 py-5 lg:grid-cols-[1.6fr_1fr_2.4fr_1fr_auto] ${
              i !== 0 ? 'border-t border-hairline' : ''
            }`}
          >
            {/* Wallet */}
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-lime text-primary-foreground">
                <Bot className="size-5" strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">{w.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{w.address}</span>
              </div>
            </div>

            {/* Value */}
            <div className="font-mono text-lg font-semibold tracking-tight text-foreground">{w.value}</div>

            {/* Rails */}
            <div className="flex flex-wrap items-center gap-2">
              {w.rails.length === 0 ? (
                <span className="text-xs text-muted-foreground">No rails set</span>
              ) : (
                w.rails.map((r) => <RailChip key={`${r.type}:${r.label}`} rail={r} />)
              )}
            </div>

            {/* Status */}
            <div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${statusStyles[w.tone] ?? statusStyles.pending}`}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {w.label}
              </span>
            </div>

            {/* Open */}
            <div className="flex lg:justify-end">
              <button
                type="button"
                onClick={() => navigate(`/dashboard/wallets/${w.agentId}`)}
                className="inline-flex items-center rounded-full bg-panel-2 px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-panel-2/70"
              >
                View
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
