import { ArrowUpRight } from 'lucide-react'
import { navLinks, WAITLIST_URL, CONSOLE_URL } from './landingData'

export default function LandingNavbar() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-white/10 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1360px] items-center justify-between px-6">
        <a href="#top" className="group flex animate-blur-in items-center gap-2">
          <img
            src="/logo.png"
            alt="PalmOS"
            className="h-7 w-auto transition-opacity group-hover:opacity-80"
          />
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {navLinks.map((link, i) => (
            <a
              key={link.href}
              href={link.href}
              className={`animate-blur-in stagger-${i + 1} text-xs tracking-tight text-white/50 transition-colors hover:text-white`}
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex animate-blur-in stagger-4 items-center gap-3">
          <a
            href="/docs"
            className="hidden text-xs tracking-tight text-white/50 transition-colors hover:text-white sm:inline-flex"
          >
            Docs
          </a>
          <a
            href={CONSOLE_URL}
            className="hidden text-xs tracking-tight text-white/50 transition-colors hover:text-white sm:inline-flex"
          >
            Console
          </a>
          <a
            href={WAITLIST_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-1.5 bg-lime px-4 py-1.5 text-xs font-medium tracking-tight text-black shadow-[0_0_15px_rgba(198,249,78,0.2)] transition-colors hover:bg-lime-hover"
          >
            Get started
            <ArrowUpRight
              className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              strokeWidth={2.25}
            />
          </a>
        </div>
      </div>
    </nav>
  )
}
