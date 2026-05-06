import { useState, useEffect } from 'react'
import { MessageSquare } from 'lucide-react'

function WaitTimer({ createdAt }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - createdAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [createdAt])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return (
    <span className="font-mono text-xs text-yellow-400/70">
      waiting {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
    </span>
  )
}

export default function ApprovalQueue({ approvals, onApprove, onDeny, interactive = true }) {
  if (approvals.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="mb-1 text-sm text-neutral-500">No pending approvals</p>
          <p className="text-xs text-neutral-700">Pending items appear when live spend exceeds policy thresholds</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5">
      <div className="space-y-3">
        {approvals.map((item) => (
          <div
            key={item.id}
            className="border border-yellow-500/20 bg-yellow-500/5 p-5"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{item.agentName}</span>
                  {item.xmtpSent && (
                    <div className="flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5">
                      <MessageSquare className="h-2.5 w-2.5 text-blue-400" strokeWidth={2} />
                      <span className="text-[9px] uppercase tracking-wider text-blue-400">XMTP</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-neutral-400">{item.action}</p>
              </div>
              <div className="text-right">
                <div className="font-mono text-xl font-medium text-white">{item.amount.toFixed(2)} PUSD</div>
                <WaitTimer createdAt={item.createdAt} />
              </div>
            </div>

            <div className="mb-5 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-neutral-600">Reason:</span>
              <span className="text-xs text-yellow-400/80">{item.reason}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-neutral-600">{item.vendor}</span>
              <div className="flex items-center gap-2">
                <button
                  disabled={!interactive}
                  onClick={() => onDeny(item.id)}
                  className={`border px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-all ${
                    interactive
                      ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
                      : 'cursor-not-allowed border-neutral-800 text-neutral-600'
                  }`}
                >
                  Deny
                </button>
                <button
                  disabled={!interactive}
                  onClick={() => onApprove(item.id)}
                  className={`border px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-all ${
                    interactive
                      ? 'border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20'
                      : 'cursor-not-allowed border-neutral-800 text-neutral-600'
                  }`}
                >
                  Approve
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
