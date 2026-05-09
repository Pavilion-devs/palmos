import { ArrowRight } from 'lucide-react'

export default function Hero({ onGetStarted }) {
  return (
    <section className="relative flex min-h-[80vh] flex-col items-center justify-center px-6 text-center md:px-12">
      <div className="pointer-events-none absolute top-0 left-0 -z-10 h-full w-full overflow-hidden opacity-30">
        <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-neutral-900 blur-[128px]" />
        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-neutral-800 blur-[128px]" />
      </div>

      <div className="palm-hero-mark" aria-hidden="true">
        <span className="palm-stem" />
        {Array.from({ length: 9 }).map((_, index) => (
          <span key={index} className={`palm-leaf palm-leaf-${index + 1}`} />
        ))}
      </div>

      <h1 className="text-glow mx-auto max-w-6xl text-6xl leading-[0.9] font-black tracking-tighter md:text-8xl lg:text-9xl">
        Give agents PUSD wallets, <br className="hidden md:block" />
        <span className="font-quicksand text-neutral-400 italic">not</span> blank
        checks.
      </h1>

      <p className="mt-6 text-xs tracking-[0.2em] text-neutral-500 uppercase md:text-sm">
        Palm USD x Solana agent payment governance
      </p>

      <p className="mt-8 max-w-2xl text-lg font-light text-neutral-400 md:text-xl">
        PalmOS lets autonomous AI workers pay APIs and services in Palm USD while
        enforcing budgets, vendor allowlists, approvals, and audit trails.
      </p>

      <button
        type="button"
        onClick={onGetStarted}
        className="group mt-12 flex items-center gap-2 border border-white/20 px-8 py-4 text-sm font-medium tracking-widest uppercase transition-all duration-300 hover:bg-white hover:text-black"
      >
        <span>Get started</span>
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={1.5} />
      </button>
    </section>
  )
}
