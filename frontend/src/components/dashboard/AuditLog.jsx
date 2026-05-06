export default function AuditLog({ events }) {
  const spendEvents = events.filter((e) => e.type !== 'check-in')

  if (spendEvents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="mb-1 text-sm text-neutral-500">Audit log empty</p>
          <p className="text-xs text-neutral-700">Live events will appear here as the backend records them</p>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-neutral-800 text-[10px] font-medium uppercase tracking-widest text-neutral-600">
            <th className="px-5 py-3">#</th>
            <th className="px-5 py-3">Time</th>
            <th className="px-5 py-3">Agent</th>
            <th className="px-5 py-3">Action</th>
            <th className="px-5 py-3 text-right">Amount</th>
            <th className="px-5 py-3">Result</th>
            <th className="px-5 py-3">Code</th>
            <th className="px-5 py-3">TxHash</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/30">
          {spendEvents.map((event, i) => {
            const resultColor =
              event.result === 'approved'
                ? 'text-green-400'
                : event.result === 'denied'
                  ? 'text-red-400'
                  : event.result === 'info'
                    ? 'text-blue-400'
                  : 'text-yellow-400'

            return (
              <tr key={event.id} className="transition-colors hover:bg-neutral-900/50">
                <td className="px-5 py-2.5 font-mono text-xs text-neutral-700">
                  {String(spendEvents.length - i).padStart(3, '0')}
                </td>
                <td className="px-5 py-2.5 font-mono text-xs text-neutral-500">{event.timestamp}</td>
                <td className="px-5 py-2.5 text-xs font-medium text-neutral-300">{event.agentName}</td>
                <td className="max-w-xs truncate px-5 py-2.5 text-xs text-neutral-400">{event.action}</td>
                <td className="px-5 py-2.5 text-right font-mono text-xs text-white">
                  {event.amount != null ? `${event.amount.toFixed(3)} PUSD` : '—'}
                </td>
                <td className="px-5 py-2.5">
                  <span className={`text-[10px] font-medium uppercase tracking-wider ${resultColor}`}>
                    {event.result}
                  </span>
                </td>
                <td className="px-5 py-2.5 font-mono text-xs text-neutral-600">
                  {event.errorCode ?? '—'}
                </td>
                <td className="px-5 py-2.5 font-mono text-xs text-neutral-600">
                  {event.txHash ? (
                    <span className="cursor-pointer transition-colors hover:text-neutral-400" title={event.txHashFull ?? event.txHash}>
                      {event.txHash}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
