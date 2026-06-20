import { ArrowRight, Play } from 'lucide-react'
import SectionFrame from './SectionFrame'
import ConsolePreview from './ConsolePreview'
import { CONSOLE_URL, DEMO_URL } from './landingData'

export default function LandingHero() {
  return (
    <SectionFrame
      id="hero"
      className="overflow-hidden px-6 pt-24 pb-16 md:pt-32"
    >
      {/* ambient glow behind the hero */}
      <div className="pointer-events-none absolute left-1/2 top-0 z-0 h-[760px] w-[1200px] max-w-none -translate-x-1/2">
        <div className="absolute left-1/2 top-[-180px] h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-lime/10 blur-[150px]" />
        <div className="absolute left-[62%] top-[-60px] h-[320px] w-[420px] -translate-x-1/2 rounded-full bg-bright/15 blur-[150px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center">
        <div className="hero-anim-item animate-blur-in mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs tracking-tight text-white/70 backdrop-blur-md">
          <span className="size-1.5 rounded-full bg-lime shadow-[0_0_8px_#c6f94e]" />
          Governed agent wallets · Byreal × Mantle
        </div>

        <h1 className="animate-blur-in stagger-1 mb-6 max-w-4xl text-balance text-4xl font-light tracking-tighter text-white md:text-6xl lg:text-7xl">
          Give agents a wallet.{' '}
          <br className="hidden md:block" />
          Keep the{' '}
          <span className="bg-gradient-to-br from-[#e8f3ec] via-[#9bf06b] to-lime bg-clip-text text-transparent">
            keys.
          </span>
        </h1>

        <p className="animate-blur-in stagger-2 mb-10 max-w-[600px] text-pretty text-base tracking-tight text-white/55 md:text-lg">
          AI agent wallets with built-in controls. Set limits, approve sensitive
          actions, and audit every on-chain move. Keys stay in OWS vaults — no
          raw keys, ever.
        </p>

        <div className="animate-blur-in stagger-3 mb-24 flex flex-col items-center gap-3 sm:flex-row">
          <a
            href={CONSOLE_URL}
            className="group flex items-center gap-2 bg-lime px-6 py-3 text-sm font-medium tracking-tight text-black shadow-[0_0_20px_rgba(198,249,78,0.2)] transition-all hover:-translate-y-0.5 hover:bg-lime-hover hover:shadow-[0_0_30px_rgba(198,249,78,0.4)]"
          >
            Get started
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-1"
              strokeWidth={2}
            />
          </a>
          <a
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium tracking-tight text-white backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10"
          >
            <Play className="size-4 fill-current" strokeWidth={0} />
            Watch demo
          </a>
        </div>

        <div className="animate-blur-in stagger-4 w-full">
          <ConsolePreview />
        </div>
      </div>
    </SectionFrame>
  )
}
