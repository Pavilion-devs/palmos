import {
  LayoutGrid,
  Wallet,
  Activity,
  ShieldCheck,
  SlidersHorizontal,
  Settings,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useWorkspace } from '../../hooks/useWorkspace'

const navItems = [
  { label: 'Overview', icon: LayoutGrid, to: '/dashboard', end: true },
  { label: 'Wallets', icon: Wallet, to: '/dashboard/wallets' },
  { label: 'Activity', icon: Activity, to: '/dashboard/activity' },
  { label: 'Approvals', icon: ShieldCheck, to: '/dashboard/approvals' },
  { label: 'Controls', icon: SlidersHorizontal, to: '/dashboard/controls' },
  { label: 'Settings', icon: Settings, to: '/dashboard/settings' },
]

export function Sidebar() {
  const { workspace } = useWorkspace()
  const workspaceName = workspace?.displayName?.trim() || 'Workspace'
  const initial = workspaceName.charAt(0).toUpperCase()

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

      {/* Workspace identity */}
      <div className="mt-auto flex flex-col gap-2">
        <div className="h-px bg-hairline" />
        <NavLink
          to="/dashboard/settings"
          className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-sidebar-accent/60"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-accent text-sm font-semibold text-lime">
            {initial}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">
              {workspaceName}
            </span>
            <span className="block text-xs text-muted-foreground">Workspace</span>
          </span>
        </NavLink>
      </div>
    </aside>
  )
}
