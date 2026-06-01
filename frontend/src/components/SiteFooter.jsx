import ScrollReveal from './motion/ScrollReveal'

export default function SiteFooter() {
  return (
    <footer className="hero-field relative mt-10 w-full overflow-hidden rounded-t-[40px] px-6 pt-20 pb-10 text-white md:px-12">
      <div className="mx-auto max-w-7xl">
        <ScrollReveal
          className="mb-16 grid grid-cols-1 gap-8 text-xs font-medium tracking-wide text-green-light/70 md:mb-20 md:grid-cols-3"
          direction="up"
          amount={0.3}
        >
          <div className="flex flex-col gap-1.5">
            <span className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-white">
              <img src="/mark-white.svg" alt="" aria-hidden="true" className="h-7 w-7" />
              PalmOS
            </span>
          </div>

          <div className="flex flex-col gap-2 md:items-center">
            <span className="text-white/40 uppercase">Connect</span>
            <a
              href="#"
              className="transition-colors hover:text-white"
              target="_blank"
              rel="noopener noreferrer"
            >
              Twitter
            </a>
            {/* <a href="#docs" className="transition-colors hover:text-white">
              Docs
            </a> */}
          </div>

          <div className="flex flex-col gap-1.5 md:items-end md:text-right">
            <span className="text-white/40 uppercase">Legal</span>
            <p>&copy; 2026 &mdash; Hackathon Entry</p>
          </div>
        </ScrollReveal>

        <ScrollReveal className="select-none" direction="still" amount={0.25}>
          <h2 className="bg-gradient-to-b from-white to-green-light/40 bg-clip-text text-[17vw] leading-[0.8] font-bold tracking-[-0.05em] whitespace-nowrap text-transparent">
            PalmOS
          </h2>
          <p className="mt-4 text-xs font-light tracking-[0.22em] text-green-light/60 uppercase md:text-sm">
            wallets, not blank checks
          </p>
        </ScrollReveal>
      </div>
    </footer>
  )
}
