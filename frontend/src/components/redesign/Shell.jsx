import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function Shell({ title, children }) {
  return (
    // Fixed app shell: the whole thing is one viewport tall; the sidebar stays put
    // (full height, never scrolls) and only the main column scrolls.
    <div className="flex h-screen gap-6 overflow-hidden bg-background p-4 font-sans text-foreground antialiased lg:p-6">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto pb-2">
        <Topbar title={title} />
        {children}
      </div>
    </div>
  )
}
