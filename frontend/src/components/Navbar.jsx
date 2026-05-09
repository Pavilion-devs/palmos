import { ArrowUpRight } from 'lucide-react'
import { navLinks } from '../content'

export default function Navbar({ onJoinWaitlist }) {
  return (
    <nav className="fixed top-0 z-50 flex w-full items-center justify-between border-b border-white/5 bg-black/50 px-6 py-6 mix-blend-difference backdrop-blur-md md:px-12 md:py-8">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded-sm bg-white" />
        <span className="text-xl font-medium tracking-tight">PalmOS</span>
      </div>

      <div className="hidden gap-8 text-sm font-normal text-neutral-400 md:flex">
        {navLinks.map(({ label, href }) => (
          <a
            key={label}
            href={href}
            className="transition-colors duration-300 hover:text-white"
          >
            {label}
          </a>
        ))}
      </div>

      <button
        type="button"
        onClick={onJoinWaitlist}
        className="group flex items-center gap-2 border border-neutral-700 px-5 py-2 text-xs font-medium uppercase tracking-wide transition-all duration-300 hover:bg-white hover:text-black"
      >
        <span>Join waitlist</span>
        <ArrowUpRight
          className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          strokeWidth={1.5}
        />
      </button>
    </nav>
  )
}
