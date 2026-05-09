import {
  ArrowLeftRight,
  CheckCircle2,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Wrench,
} from 'lucide-react'

export const NAV_ITEMS = [
  { id: 'home', label: 'Dashboard', icon: LayoutDashboard, route: '#dashboard' },
  { id: 'agents', label: 'My Agents', icon: ShieldCheck, route: '#dashboard/agents' },
  { id: 'services', label: 'Services', icon: Wrench, route: '#dashboard/services' },
  {
    id: 'transactions',
    label: 'Transactions',
    icon: ArrowLeftRight,
    route: '#dashboard/transactions',
  },
  {
    id: 'approvals',
    label: 'Approvals',
    icon: CheckCircle2,
    route: '#dashboard/approvals',
  },
  { id: 'settings', label: 'Settings', icon: Settings, route: '#dashboard/settings' },
]
