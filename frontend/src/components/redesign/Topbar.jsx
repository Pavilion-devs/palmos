import { useEffect, useState } from 'react'
import { Bell, LogOut, Search } from 'lucide-react'
import { useOperatorSession } from '../../hooks/useOperatorSession'
import useDashboardApprovals from '../../hooks/useDashboardApprovals'
import { selectPendingApprovals } from './data/selectors'
import { SearchOverlay } from './topbar/SearchOverlay'
import { NotificationsPanel } from './topbar/NotificationsPanel'

function formatAddress(address) {
  return address && address.length > 8
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : address
}

export function Topbar({ title }) {
  const { operator, signOut } = useOperatorSession()
  const { approvals } = useDashboardApprovals()
  const pending = selectPendingApprovals(approvals)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
          onClick={() => setSearchOpen(true)}
          className="flex size-11 items-center justify-center rounded-full bg-panel-2 text-foreground transition-colors hover:bg-panel-2/70"
        >
          <Search className="size-5" strokeWidth={2} aria-hidden="true" />
        </button>
        <div className="relative">
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => setNotifOpen((open) => !open)}
            className="relative flex size-11 items-center justify-center rounded-full bg-panel-2 text-foreground transition-colors hover:bg-panel-2/70"
          >
            <Bell className="size-5" strokeWidth={2} aria-hidden="true" />
            {pending.length > 0 && (
              <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-lime ring-2 ring-panel-2" />
            )}
          </button>
          {notifOpen && (
            <NotificationsPanel
              pending={pending}
              onClose={() => setNotifOpen(false)}
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          aria-label="Sign out"
          className="flex size-11 items-center justify-center rounded-full bg-panel-2 text-foreground transition-colors hover:bg-blocked/15 hover:text-blocked"
        >
          <LogOut className="size-5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </header>
  )
}
