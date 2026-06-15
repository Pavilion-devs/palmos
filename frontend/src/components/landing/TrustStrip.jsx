import SectionFrame from './SectionFrame'
import { builtWith, stats } from './landingData'

export default function TrustStrip() {
  return (
    <SectionFrame id="trust" className="z-10 px-6 py-24 md:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 flex flex-col items-center text-center">
          <div className="scroll-fade-in mb-8 font-mono text-[11px] uppercase tracking-[0.25em] text-white/40">
            Built on open rails
          </div>
          <div className="scroll-fade-in flex flex-wrap items-center justify-center gap-x-8 gap-y-4 md:gap-x-12">
            {builtWith.map((name) => (
              <span
                key={name}
                className="text-lg font-medium tracking-tight text-white/35 transition-colors hover:text-white/70 md:text-xl"
              >
                {name}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 border-l border-t border-white/10 md:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="scroll-fade-in flex flex-col gap-2 border-r border-b border-white/10 p-6 md:p-8"
            >
              <span className="font-mono text-4xl font-bold tracking-tight text-lime md:text-5xl">
                {stat.value}
              </span>
              <span className="text-xs leading-relaxed tracking-tight text-white/50">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </SectionFrame>
  )
}
