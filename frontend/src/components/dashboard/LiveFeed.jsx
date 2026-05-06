import { CheckCircle, Clock, XCircle, Info } from 'lucide-react'

const RESULT_CONFIG = {
  approved: { icon: CheckCircle, bg: 'bg-green-500/10', text: 'text-green-400', label: 'AUTO-APPROVED' },
  pending: { icon: Clock, bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: 'PENDING APPROVAL' },
  denied: { icon: XCircle, bg: 'bg-red-500/10', text: 'text-red-400', label: 'BLOCKED' },
  info: { icon: Info, bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'CHECK-IN' },
}

export default function LiveFeed({ events }) {
  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="mb-1 text-sm text-neutral-500">No events yet</p>
          <p className="text-xs text-neutral-700">Start the worker from the header to populate the feed</p>
        </div>
      </div>
    )
  }

  return (
    <div className="divide-y divide-neutral-800/50">
      {events.map((event, i) => {
        const config = RESULT_CONFIG[event.result] || RESULT_CONFIG.info
        const Icon = config.icon
        return (
          <div
            key={event.id}
            className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-neutral-900/50"
            style={{ animation: i === 0 ? 'slideIn 0.3s ease-out' : undefined }}
            title={event.reason}
          >
            <span className="shrink-0 font-mono text-xs text-neutral-600">{event.timestamp}</span>
            <span className="w-28 shrink-0 truncate text-xs font-medium text-neutral-300">{event.agentName}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-neutral-400">{event.action}</span>
            {event.amount != null && (
              <span className="shrink-0 font-mono text-xs text-white">
                {event.amount.toFixed(3)} PUSD
              </span>
            )}
            <div className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 ${config.bg}`}>
              <Icon className={`h-3 w-3 ${config.text}`} strokeWidth={2} />
              <span className={`text-[10px] font-medium uppercase tracking-wider ${config.text}`}>
                {event.badgeLabel ?? config.label}
              </span>
            </div>
            {event.vendor && (
              <span className="hidden shrink-0 font-mono text-[10px] text-neutral-600 lg:block">
                {event.vendor}
              </span>
            )}
            {event.errorCode && (
              <span className="hidden shrink-0 font-mono text-[10px] text-red-400 xl:block">
                {event.errorCode}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
