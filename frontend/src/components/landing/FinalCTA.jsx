import { ArrowRight } from 'lucide-react'
import SectionFrame from './SectionFrame'
import { CONSOLE_URL } from './landingData'

export default function FinalCTA() {
  return (
    <SectionFrame className="z-10 flex flex-col items-center px-6 py-32 text-center">
      <h2 className="scroll-fade-in mb-6 max-w-2xl text-balance text-4xl font-light tracking-tighter text-white md:text-5xl">
        Give your agents a wallet.
        <br className="hidden sm:block" /> Keep the keys.
      </h2>
      <p className="scroll-fade-in mb-10 text-base tracking-tight text-white/60">
        Governed wallets, real settlement, full audit trail — from one console.
      </p>
      <div className="scroll-fade-in flex flex-col items-center gap-3 sm:flex-row">
        <a
          href={CONSOLE_URL}
          className="group flex items-center gap-2 bg-lime px-8 py-4 text-sm font-medium tracking-tight text-black transition-colors hover:bg-lime-hover"
        >
          Get started
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </a>
        <a
          href={CONSOLE_URL}
          className="flex items-center gap-2 border border-white/15 bg-white/5 px-8 py-4 text-sm font-medium tracking-tight text-white transition-colors hover:border-white/30 hover:bg-white/10"
        >
          Open the console
        </a>
      </div>
    </SectionFrame>
  )
}
