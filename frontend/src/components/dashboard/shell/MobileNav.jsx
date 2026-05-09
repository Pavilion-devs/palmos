import { navigate } from '../../../hooks/useHashRoute'
import { NAV_ITEMS } from './navItems'

export default function MobileNav({ activePage, pendingCount }) {
  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-neutral-800 bg-neutral-950 px-3 py-2 md:hidden">
      {NAV_ITEMS.map((item) => {
        const isActive = item.id === activePage
        const showBadge = item.id === 'approvals' && pendingCount > 0
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(item.route)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border px-3 py-1.5 text-xs uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${
              isActive
                ? 'border-white bg-white text-black'
                : 'border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-white'
            }`}
          >
            {item.label}
            {showBadge && (
              <span
                className={`rounded-full px-1 font-mono text-[10px] ${
                  isActive ? 'bg-black/20 text-black' : 'bg-yellow-500/20 text-yellow-400'
                }`}
              >
                {pendingCount}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
