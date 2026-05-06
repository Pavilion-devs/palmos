import { useRef, useEffect } from 'react'

export default function ActivityTicker({ events }) {
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0
    }
  }, [events.length])

  if (events.length === 0) {
    return (
      <div className="flex h-8 shrink-0 items-center border-t border-neutral-800 bg-neutral-950 px-5">
        <span className="text-[10px] text-neutral-700">Awaiting live events...</span>
      </div>
    )
  }

  const tickerItems = events.slice(0, 20)

  return (
    <div className="flex h-8 shrink-0 items-center border-t border-neutral-800 bg-neutral-950">
      <div className="flex shrink-0 items-center border-r border-neutral-800 px-3">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
      </div>
      <div ref={scrollRef} className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto">
        {tickerItems.map((event, i) => {
          const color =
            event.result === 'approved'
              ? 'text-green-400'
              : event.result === 'denied'
                ? 'text-red-400'
                : event.result === 'pending'
                  ? 'text-yellow-400'
                  : 'text-blue-400'

          return (
            <div key={event.id} className="flex shrink-0 items-center">
              <div className="flex items-center gap-2 px-4">
                <span className="font-mono text-[10px] text-neutral-700">{event.timestamp}</span>
                <span className="text-[10px] text-neutral-400">{event.agentName}</span>
                <span className="text-[10px] text-neutral-600">→</span>
                {event.amount != null && (
                  <span className="font-mono text-[10px] text-neutral-300">{event.amount.toFixed(3)} PUSD</span>
                )}
                <span className={`text-[10px] font-medium uppercase ${color}`}>
                  {event.badgeLabel ?? (event.result === 'approved'
                    ? 'APPROVED'
                    : event.result === 'denied'
                      ? 'DENIED'
                      : event.result === 'pending'
                        ? 'PENDING'
                        : 'CHECK-IN')}
                </span>
                {event.vendor && (
                  <span className="text-[10px] text-neutral-700">{event.vendor}</span>
                )}
              </div>
              {i < tickerItems.length - 1 && (
                <div className="h-3 w-px bg-neutral-800" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
