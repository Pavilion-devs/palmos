import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Bot, ArrowRight } from 'lucide-react'
import { useAgents } from '../../../hooks/useAgents'
import { selectWalletRows } from '../data/selectors'

const PAGES = [
  { label: 'Overview', to: '/dashboard' },
  { label: 'Wallets', to: '/dashboard/wallets' },
  { label: 'Activity', to: '/dashboard/activity' },
  { label: 'Approvals', to: '/dashboard/approvals' },
  { label: 'Controls', to: '/dashboard/controls' },
  { label: 'Settings', to: '/dashboard/settings' },
]

// Command-palette search: jump to an agent wallet or a page. Opened by the Topbar
// search button or ⌘K / Ctrl-K.
export function SearchOverlay({ onClose }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const { agents } = useAgents()
  const wallets = selectWalletRows(agents)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = query.trim().toLowerCase()
  const matchedWallets = (
    q
      ? wallets.filter(
          (w) =>
            w.name?.toLowerCase().includes(q) ||
            w.address?.toLowerCase().includes(q),
        )
      : wallets
  ).slice(0, 6)
  const matchedPages = q
    ? PAGES.filter((p) => p.label.toLowerCase().includes(q))
    : PAGES

  function go(to) {
    onClose?.()
    navigate(to)
  }

  function onSubmit(event) {
    event.preventDefault()
    if (matchedWallets[0]) go(`/dashboard/wallets/${matchedWallets[0].agentId}`)
    else if (matchedPages[0]) go(matchedPages[0].to)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center px-4 pt-24">
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative h-fit w-full max-w-xl overflow-hidden rounded-[var(--radius)] border border-hairline bg-panel">
        <form
          onSubmit={onSubmit}
          className="flex items-center gap-3 border-b border-hairline px-4 py-3"
        >
          <Search className="size-5 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents, addresses, pages…"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-hairline px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            esc
          </kbd>
        </form>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {matchedWallets.length > 0 && (
            <div className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Wallets
            </div>
          )}
          {matchedWallets.map((w) => (
            <button
              key={w.agentId}
              type="button"
              onClick={() => go(`/dashboard/wallets/${w.agentId}`)}
              className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2.5 text-left transition-colors hover:bg-panel-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-lime text-primary-foreground">
                <Bot className="size-4" strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{w.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">{w.address}</span>
              </span>
              <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{w.value}</span>
            </button>
          ))}

          {matchedPages.length > 0 && (
            <div className="px-2 pb-1 pt-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Pages
            </div>
          )}
          {matchedPages.map((p) => (
            <button
              key={p.to}
              type="button"
              onClick={() => go(p.to)}
              className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-panel-2"
            >
              <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
              {p.label}
            </button>
          ))}

          {matchedWallets.length === 0 && matchedPages.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No matches for “{query}”.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
