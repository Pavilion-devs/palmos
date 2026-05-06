import { Play, RefreshCcw } from 'lucide-react'
import { useState, useEffect } from 'react'

export default function DashboardHeader({
  totalAgentCount,
  activeCount,
  totalSpent,
  pendingCount,
  connectionStatus,
  isActionPending,
  generatedAt,
  actionLabel,
  onAction,
  onResetSetup,
}) {
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => {
      setClock(new Date().toLocaleTimeString('en-US', { hour12: false }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const syncedAt = generatedAt
    ? new Date(generatedAt).toLocaleTimeString('en-US', { hour12: false })
    : '—'
  const connectionLabel =
    connectionStatus === 'live'
      ? 'Live'
      : connectionStatus === 'connecting'
        ? 'Connecting'
        : 'Offline'
  const connectionDot =
    connectionStatus === 'live'
      ? 'animate-pulse bg-green-500'
      : connectionStatus === 'connecting'
        ? 'animate-pulse bg-yellow-500'
        : 'bg-red-500'

  return (
    <header className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-5 py-3">
      <div className="flex items-center gap-3">
        <a href="#" className="flex items-center gap-2 transition-opacity hover:opacity-70">
          <div className="h-4 w-4 rounded-sm bg-white" />
          <span className="text-sm font-medium tracking-tight">PalmOS</span>
        </a>
        <span className="font-mono text-xs text-neutral-600">/</span>
        <span className="font-mono text-xs text-neutral-500">dashboard</span>
      </div>

      <div className="hidden items-center gap-6 md:flex">
        <div className="flex items-center gap-2 border-r border-neutral-800 pr-6">
          <span className="text-xs uppercase tracking-widest text-neutral-600">Agents</span>
          <span className="font-mono text-sm text-white">{totalAgentCount}</span>
        </div>
        <div className="flex items-center gap-2 border-r border-neutral-800 pr-6">
          <span className="text-xs uppercase tracking-widest text-neutral-600">Active</span>
          <span className="font-mono text-sm text-white">{activeCount}</span>
        </div>
        <div className="flex items-center gap-2 border-r border-neutral-800 pr-6">
          <span className="text-xs uppercase tracking-widest text-neutral-600">Spent</span>
          <span className="font-mono text-sm text-white">{totalSpent.toFixed(3)} PUSD</span>
        </div>
        <div className="flex items-center gap-2 border-r border-neutral-800 pr-6">
          <span className="text-xs uppercase tracking-widest text-neutral-600">Pending</span>
          <span className={`font-mono text-sm ${pendingCount > 0 ? 'text-yellow-400' : 'text-white'}`}>{pendingCount}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-neutral-600">{clock}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-neutral-600">Synced</span>
          <span className="font-mono text-sm text-white">{syncedAt}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onResetSetup}
          className="hidden text-[10px] uppercase tracking-widest text-neutral-600 transition-colors hover:text-white md:block"
        >
          Setup
        </button>
        <div className="flex items-center gap-1.5 rounded border border-neutral-800 px-2.5 py-1">
          <div className={`h-1.5 w-1.5 rounded-full ${connectionDot}`} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">
            {connectionLabel} / Solana
          </span>
        </div>
        <button
          onClick={onAction}
          disabled={isActionPending}
          className={`flex items-center gap-2 border px-4 py-1.5 text-xs font-medium uppercase tracking-wider transition-all duration-200 ${
            isActionPending
              ? 'cursor-wait border-neutral-800 text-neutral-500'
              : 'border-neutral-700 text-white hover:bg-white hover:text-black'
          }`}
        >
          {isActionPending ? (
            <>
              <RefreshCcw className="h-3 w-3 animate-spin" strokeWidth={2} />
              <span>{actionLabel}</span>
            </>
          ) : (
            <>
              <Play className="h-3 w-3" strokeWidth={2} />
              <span>{actionLabel}</span>
            </>
          )}
        </button>
      </div>
    </header>
  )
}
