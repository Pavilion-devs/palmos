import { useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { navigate } from '../../../hooks/useHashRoute'
import SettlementBadge from './SettlementBadge'

const SETTLEMENT_FILTER_OPTIONS = [
  { value: 'all', label: 'All settlement modes' },
  { value: 'real', label: 'Real Solana PUSD' },
  { value: 'umbra', label: 'Umbra private' },
  { value: 'local', label: 'Local service-test' },
  { value: 'approval_pending', label: 'Approval pending' },
  { value: 'blocked', label: 'Blocked' },
]

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'executed', label: 'Executed' },
  { value: 'approval_pending', label: 'Approval pending' },
  { value: 'waiting_for_execution', label: 'Waiting for execution' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'failed', label: 'Failed' },
]

function formatPusd(value, digits = 3) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '0.000'
}

function shortHash(value) {
  if (!value) return null
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

function FilterSelect({ value, onChange, options, ariaLabel }) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="border border-neutral-800 bg-black px-3 py-1.5 text-xs text-white focus:border-white focus:outline-none"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function TransactionRow({ event, services }) {
  const service = services.find((s) => s.serviceId === event.serviceId)
  const isUmbra = event.settlementMode === 'umbra' || event.umbraSettlement
  const serviceLabel = isUmbra
    ? 'Umbra private settlement'
    : service?.label ?? event.serviceId ?? '—'
  const routeLabel = isUmbra
    ? `${event.umbraSettlement?.privacyPath ?? 'umbra_mixer_utxo'} · ${event.chainId ?? event.umbraSettlement?.network ?? 'solana-devnet'}`
    : null
  const canOpenExplorer = Boolean(event.txExplorerUrl)

  function openDetail() {
    navigate(`#dashboard/transactions/${event.id}`)
  }

  function handleKeyDown(eventKey) {
    if (eventKey.key === 'Enter' || eventKey.key === ' ') {
      eventKey.preventDefault()
      openDetail()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={handleKeyDown}
      className="flex w-full flex-col gap-3 border border-neutral-800 bg-neutral-950 p-4 text-left transition-colors hover:border-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white sm:flex-row sm:items-center sm:gap-5"
    >
      <div className="shrink-0">
        <SettlementBadge mode={event.settlementMode} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm text-white">{event.action}</span>
          <span className="ml-auto shrink-0 font-mono text-sm text-white">
            {event.amount != null ? `${formatPusd(event.amount)} ${event.assetSymbol ?? 'PUSD'}` : '—'}
          </span>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-neutral-500 sm:grid-cols-4">
          <span className="truncate">
            <span className="text-neutral-700">Agent:</span> {event.agentName}
          </span>
          <span className="truncate">
            <span className="text-neutral-700">Service:</span> {serviceLabel}
          </span>
          <span className="truncate">
            <span className="text-neutral-700">Vendor:</span> {event.vendor}
          </span>
          <span className="truncate font-mono">{event.timestamp}</span>
        </div>
        {event.txHashFull && (
          <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] text-neutral-600">
            <span className="truncate">tx: {shortHash(event.txHashFull)}</span>
            {canOpenExplorer && (
              <a
                href={event.txExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(clickEvent) => clickEvent.stopPropagation()}
                className="inline-flex items-center gap-1 text-green-300/80 transition-colors hover:text-green-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                aria-label="Open transaction explorer"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                Open
              </a>
            )}
            {routeLabel && (
              <span className="truncate text-violet-300/70">{routeLabel}</span>
            )}
          </div>
        )}
        {!event.txHashFull && routeLabel && (
          <div className="mt-2 truncate font-mono text-[10px] text-violet-300/70">
            {routeLabel}
          </div>
        )}
      </div>
    </div>
  )
}

export default function TransactionsPage({ events, agents, services }) {
  const [agentFilter, setAgentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [settlementFilter, setSettlementFilter] = useState('all')

  const spendEvents = useMemo(
    () => events.filter((event) => event.type === 'spend'),
    [events],
  )

  const filtered = useMemo(() => {
    return spendEvents.filter((event) => {
      if (agentFilter !== 'all' && event.agentId !== agentFilter) return false
      if (statusFilter !== 'all' && event.status !== statusFilter) return false
      if (settlementFilter !== 'all' && event.settlementMode !== settlementFilter) {
        return false
      }
      return true
    })
  }, [spendEvents, agentFilter, statusFilter, settlementFilter])

  const realCount = spendEvents.filter((e) => e.settlementMode === 'real').length
  const umbraCount = spendEvents.filter((e) => e.settlementMode === 'umbra').length
  const totalSpent = spendEvents
    .filter((e) => e.settlementMode === 'real' || e.settlementMode === 'local')
    .reduce((sum, e) => sum + (e.amount ?? 0), 0)

  const agentOptions = [
    { value: 'all', label: 'All agents' },
    ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
  ]

  const filtersActive =
    agentFilter !== 'all' || statusFilter !== 'all' || settlementFilter !== 'all'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-800 px-6 py-5">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-600">
            Transactions
          </div>
          <h1 className="mt-1 text-xl font-medium text-white">
            {spendEvents.length} paid {spendEvents.length === 1 ? 'call' : 'calls'} recorded
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="border border-neutral-800 bg-neutral-900 px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-widest text-neutral-500">
              Real settled
            </span>
            <span className="ml-2 font-mono text-xs text-green-400">{realCount}</span>
          </div>
          <div className="border border-neutral-800 bg-neutral-900 px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-widest text-neutral-500">
              Total moved
            </span>
            <span className="ml-2 font-mono text-xs text-white">
              {formatPusd(totalSpent)} PUSD
            </span>
          </div>
          <div className="border border-neutral-800 bg-neutral-900 px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-widest text-neutral-500">
              Umbra proofs
            </span>
            <span className="ml-2 font-mono text-xs text-violet-300">{umbraCount}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-900 px-6 py-3">
        <span className="text-[10px] uppercase tracking-widest text-neutral-600">Filter</span>
        <FilterSelect
          ariaLabel="Filter by agent"
          value={agentFilter}
          onChange={setAgentFilter}
          options={agentOptions}
        />
        <FilterSelect
          ariaLabel="Filter by status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_FILTER_OPTIONS}
        />
        <FilterSelect
          ariaLabel="Filter by settlement mode"
          value={settlementFilter}
          onChange={setSettlementFilter}
          options={SETTLEMENT_FILTER_OPTIONS}
        />
        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setAgentFilter('all')
              setStatusFilter('all')
              setSettlementFilter('all')
            }}
            className="text-[10px] uppercase tracking-widest text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            Clear
          </button>
        )}
        <span className="ml-auto font-mono text-[11px] text-neutral-600">
          showing {filtered.length} / {spendEvents.length}
        </span>
      </div>

      <div className="flex-1 px-6 py-5">
        {filtered.length === 0 ? (
          <div className="border border-dashed border-neutral-800 px-6 py-12 text-center">
            <p className="text-sm text-neutral-400">
              {spendEvents.length === 0
                ? 'No paid calls recorded yet.'
                : 'No transactions match the current filters.'}
            </p>
            {spendEvents.length === 0 && (
              <p className="mt-1 text-[11px] uppercase tracking-widest text-neutral-700">
                Run an agent or trigger a paid SDK call to see transactions here.
              </p>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((event) => (
              <li key={event.id}>
                <TransactionRow event={event} services={services} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
