const SETTLEMENT_LABELS = {
  real: { label: 'Real Solana PUSD', tone: 'text-green-400 border-green-500/30 bg-green-500/5' },
  local: { label: 'Successful', tone: 'text-blue-300 border-blue-500/30 bg-blue-500/5' },
  approval_pending: {
    label: 'Approval pending',
    tone: 'text-yellow-300 border-yellow-500/30 bg-yellow-500/5',
  },
  blocked: { label: 'Blocked', tone: 'text-red-400 border-red-500/30 bg-red-500/5' },
  unknown: { label: 'Unknown', tone: 'text-neutral-400 border-neutral-700 bg-neutral-900' },
}

export default function SettlementBadge({ mode }) {
  const config = SETTLEMENT_LABELS[mode] ?? SETTLEMENT_LABELS.unknown
  const dotClass =
    mode === 'real'
      ? 'bg-green-400'
      : mode === 'local'
        ? 'bg-blue-300'
        : mode === 'approval_pending'
          ? 'animate-pulse bg-yellow-300'
          : mode === 'blocked'
            ? 'bg-red-400'
            : 'bg-neutral-500'

  return (
    <span
      className={`inline-flex min-w-32 items-center justify-center gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-widest ${config.tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {config.label}
    </span>
  )
}
