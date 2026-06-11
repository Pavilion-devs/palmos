import {
  LayoutGrid,
  Wallet,
  Activity,
  ShieldCheck,
  SlidersHorizontal,
  Settings,
  LifeBuoy,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'

const navItems = [
  { label: 'Overview', icon: LayoutGrid, to: '/dashboard', end: true },
  { label: 'Wallets', icon: Wallet, to: '/dashboard/wallets' },
  { label: 'Activity', icon: Activity, to: '/dashboard/activity' },
  { label: 'Approvals', icon: ShieldCheck, to: '/dashboard/approvals' },
  { label: 'Controls', icon: SlidersHorizontal, to: '/dashboard/controls' },
  { label: 'Settings', icon: Settings, to: '/dashboard/settings' },
]

export function Sidebar() {
  return (
    <aside className="flex w-[248px] shrink-0 flex-col rounded-3xl bg-sidebar p-5">
      {/* Logo */}
      <div className="flex items-center px-2 py-3">
        <img src="/logo.png" alt="PalmOS" className="h-9 w-auto" />
      </div>

      {/* Nav */}
      <nav className="mt-6 flex flex-col gap-1">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sidebar-accent text-lime'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                }`
              }
            >
              <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        <div className="h-px bg-hairline" />
        <button
          type="button"
          className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <LifeBuoy className="size-5" strokeWidth={2} aria-hidden="true" />
          Support
        </button>
      </div>
    </aside>
  )
}
