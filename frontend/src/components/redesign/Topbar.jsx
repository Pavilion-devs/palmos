import { Bell, LogOut, Search } from 'lucide-react'
import { useOperatorSession } from '../../hooks/useOperatorSession'

function formatAddress(address) {
  return address && address.length > 8
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : address
}

export function Topbar({ title }) {
  const { operator, signOut } = useOperatorSession()

  const label = operator?.walletAddress
    ? formatAddress(operator.walletAddress)
    : (operator?.displayName ?? 'Operator')
  const initials = (operator?.displayName ?? operator?.walletAddress ?? 'OP')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase()

  return (
    <header className="flex items-center justify-between gap-4">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">{title}</h1>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 rounded-full bg-panel-2 py-1.5 pl-1.5 pr-4">
          <span className="flex size-8 items-center justify-center rounded-full bg-panel font-mono text-xs font-semibold text-foreground ring-2 ring-lime">
            {initials}
          </span>
          <span className="font-mono text-sm text-foreground" title={operator?.walletAddress ?? undefined}>
            {label}
          </span>
        </div>
        <button
          type="button"
          aria-label="Search"
          className="flex size-11 items-center justify-center rounded-full bg-panel-2 text-foreground transition-colors hover:bg-panel-2/70"
        >
          <Search className="size-5" strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex size-11 items-center justify-center rounded-full bg-panel-2 text-foreground transition-colors hover:bg-panel-2/70"
        >
          <Bell className="size-5" strokeWidth={2} aria-hidden="true" />
          <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-lime ring-2 ring-panel-2" />
        </button>
        <button
          type="button"
          onClick={() => void signOut()}
          aria-label="Sign out"
          className="flex size-11 items-center justify-center rounded-full bg-panel-2 text-foreground transition-colors hover:bg-blocked/15 hover:text-blocked"
        >
          <LogOut className="size-5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
