import { ArrowUpRight } from 'lucide-react'
import ScrollReveal from './motion/ScrollReveal'

const WAITLIST_URL = 'https://tally.so/r/aQva1q'
const productLinks = [
  { label: 'Product', href: '#product' },
  { label: 'Controls', href: '#controls' },
  { label: 'Workflows', href: '#workflows' },
  { label: 'Integrations', href: '#integrations' },
  { label: 'How It Works', href: '#how-it-works' },
]

const communityLinks = [
  { label: 'Twitter / X', href: 'https://x.com/palmos_xyz' },
  { label: 'Telegram', href: 'https://t.me/+MNq4VCVNlEgyMWY0' },
  { label: 'GitHub', href: 'https://github.com' },
]

export default function SiteFooter() {
  return (
    <footer className="hero-field relative mt-10 w-full overflow-hidden rounded-t-[40px] px-6 pt-20 pb-10 text-white md:px-12">
      <div className="mx-auto max-w-7xl">

        <ScrollReveal
          className="mb-16 grid grid-cols-1 gap-12 md:mb-20 md:grid-cols-4 md:gap-8"
          direction="up"
          amount={0.3}
        >
          {/* Brand col */}
          <div className="flex flex-col gap-5 md:col-span-2">
            <a href="#top" className="inline-flex items-center gap-2">
              <img src="/vite.svg" alt="" aria-hidden="true" className="h-6 w-6" />
              <span className="text-lg font-bold tracking-tight text-white">PalmOS</span>
            </a>
            <p className="max-w-xs text-sm font-light leading-relaxed text-green-light/60">
              Give AI agents controlled access to wallets, portfolios, and on-chain actions.
              No raw keys, ever.
            </p>
            <a
              href={WAITLIST_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/20"
            >
              Join the waitlist
              <ArrowUpRight
                className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                strokeWidth={2}
              />
            </a>
          </div>

          {/* Product links */}
          <div className="flex flex-col gap-3">
            <span className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">
              Product
            </span>
            {productLinks.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="text-sm font-light text-green-light/70 transition-colors hover:text-white"
              >
                {label}
              </a>
            ))}
          </div>

          {/* Community links */}
          <div className="flex flex-col gap-3">
            <span className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">
              Community
            </span>
            {communityLinks.map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-light text-green-light/70 transition-colors hover:text-white"
              >
                {label}
              </a>
            ))}
          </div>
        </ScrollReveal>

        {/* Bottom wordmark */}
        <ScrollReveal className="select-none" direction="still" amount={0.25}>
          <h2 className="bg-gradient-to-b from-white to-green-light/40 bg-clip-text text-[17vw] leading-[0.8] font-bold tracking-[-0.05em] whitespace-nowrap text-transparent">
            PalmOS
          </h2>
          <div className="mt-6 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
            <p className="text-xs font-light tracking-[0.18em] text-green-light/50 uppercase">
              wallets, not blank checks
            </p>
            <p className="text-xs text-white/30">
              &copy; 2026 PalmOS. All rights reserved.
            </p>
          </div>
        </ScrollReveal>

      </div>
    </footer>
  )
}
