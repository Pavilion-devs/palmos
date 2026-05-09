import AppSidebar from './AppSidebar'
import MobileNav from './MobileNav'

export default function DashboardShell({
  activePage,
  pendingCount,
  topbar,
  syncError,
  children,
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-black text-white">
      <AppSidebar activePage={activePage} pendingCount={pendingCount} />
      <div className="flex min-w-0 flex-1 flex-col">
        {topbar}
        <MobileNav activePage={activePage} pendingCount={pendingCount} />
        {syncError && (
          <div className="shrink-0 border-b border-red-500/20 bg-red-500/5 px-5 py-2">
            <p className="text-xs text-red-300">{syncError}</p>
          </div>
        )}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
