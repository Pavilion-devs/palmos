import { Twitter, Github } from 'lucide-react'
import { navLinks, WAITLIST_URL, CONSOLE_URL, DEMO_URL } from './landingData'

const PRODUCT_LINKS = [
  ...navLinks,
  { label: 'Console', href: CONSOLE_URL },
]

const RESOURCE_LINKS = [
  { label: 'Watch demo', href: DEMO_URL },
  { label: 'Join waitlist', href: WAITLIST_URL },
]

export default function LandingFooter() {
  return (
    <footer className="relative z-10 border-t border-white/10 bg-white/5 px-6 py-12 backdrop-blur-md">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 scroll-fade-in md:grid-cols-4 md:gap-6">
        <div className="col-span-1 flex flex-col items-start md:col-span-2">
          <img src="/logo.png" alt="PalmOS" className="mb-4 h-7 w-auto" />
          <p className="max-w-xs text-xs tracking-tight text-white/50">
            Governed wallets for AI agents. Set limits, approve sensitive
            actions, and audit every on-chain move — keys never leave OWS.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-widest text-white">
            Product
          </h4>
          {PRODUCT_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-xs tracking-tight text-white/50 transition-colors hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-widest text-white">
            Resources
          </h4>
          {RESOURCE_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs tracking-tight text-white/50 transition-colors hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-16 flex max-w-6xl flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 scroll-fade-in md:flex-row">
        <p className="text-[10px] tracking-tight text-white/40">
          © 2026 PalmOS. All rights reserved.
        </p>
        <div className="flex gap-4">
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/40 transition-colors hover:text-white"
            aria-label="X (Twitter)"
          >
            <Twitter className="size-4" />
          </a>
          <a
            href="#"
            className="text-white/40 transition-colors hover:text-white"
            aria-label="GitHub"
          >
            <Github className="size-4" />
          </a>
        </div>
      </div>
    </footer>
  )
}
