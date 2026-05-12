import { navigate } from '../../../hooks/useHashRoute'
import { NAV_ITEMS } from './navItems'

export default function AppSidebar({ activePage, pendingCount }) {
  return (
    <aside className="hidden w-[220px] shrink-0 flex-col border-r border-neutral-800 bg-neutral-950 md:flex">
      <button
        type="button"
        onClick={() => navigate('#dashboard')}
        className="flex h-14 items-center gap-2 border-b border-neutral-800 px-5 w-full text-left hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
      >
        <div className="h-4 w-4 rounded-sm bg-white" />
        <span className="text-sm font-medium tracking-tight text-white">PalmOS</span>
      </button>

      <nav className="flex-1 overflow-y-auto py-3">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activePage
          const Icon = item.icon
          const showBadge = item.id === 'approvals' && pendingCount > 0
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.route)}
              className={`flex w-full items-center justify-between gap-2 px-5 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${
                isActive
                  ? 'border-l-2 border-white bg-neutral-900 text-white'
                  : 'border-l-2 border-transparent text-neutral-400 hover:bg-neutral-900/50 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </span>
              {showBadge && (
                <span className="rounded-full bg-yellow-500/20 px-1.5 py-0.5 font-mono text-[10px] text-yellow-400">
                  {pendingCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-neutral-800 p-4">
        <div className="text-[10px] uppercase tracking-widest text-neutral-600">Workspace</div>
        <div className="mt-1 truncate text-xs text-neutral-400">Default workspace</div>
      </div>
    </aside>
  )
}
