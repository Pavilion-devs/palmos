import { Play, RefreshCcw } from 'lucide-react'
import { useEffect, useState } from 'react'

function formatClock(value) {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('en-US', { hour12: false })
}

export default function Topbar({
  pageSubtitle,
  pageTitle,
  connectionStatus,
  generatedAt,
  isActionPending,
  actionLabel,
  onAction,
  rightSlot,
}) {
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString('en-US', { hour12: false }),
  )

  useEffect(() => {
    const id = setInterval(() => {
      setClock(new Date().toLocaleTimeString('en-US', { hour12: false }))
    }, 1000)
    return () => clearInterval(id)
  }, [])

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
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-950 px-5">
      <div className="min-w-0">
        {pageSubtitle && (
          <div className="text-[10px] uppercase tracking-widest text-neutral-600">
            {pageSubtitle}
          </div>
        )}
        <h1 className="truncate text-sm font-medium text-white">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-2 lg:flex">
          <span className="font-mono text-[10px] text-neutral-600">{clock}</span>
          <span className="text-[10px] text-neutral-700">·</span>
          <span className="text-[10px] uppercase tracking-widest text-neutral-600">Synced</span>
          <span className="font-mono text-[10px] text-neutral-400">{formatClock(generatedAt)}</span>
        </div>

        <div className="flex items-center gap-1.5 border border-neutral-800 px-2.5 py-1">
          <div className={`h-1.5 w-1.5 rounded-full ${connectionDot}`} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-400">
            {connectionLabel} · Solana
          </span>
        </div>

        {rightSlot}

        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            disabled={isActionPending}
            className={`flex items-center gap-2 border px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-all ${
              isActionPending
                ? 'cursor-wait border-neutral-800 text-neutral-500'
                : 'border-neutral-700 text-white hover:bg-white hover:text-black'
            }`}
          >
            {isActionPending ? (
              <RefreshCcw className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              <Play className="h-3 w-3" strokeWidth={2} />
            )}
            <span>{actionLabel}</span>
          </button>
        )}
      </div>
    </header>
  )
}
