import { builtWithLogos } from '../content'
import ScrollReveal from './motion/ScrollReveal'
import { LANDING_TIMING } from './motion/landingMotion'

export default function CrewSection() {
  return (
    <section id="integrations" className="relative overflow-hidden border-t border-line pt-24 pr-6 pb-24 pl-6 md:px-12">
      <div className="mx-auto max-w-7xl">
        <ScrollReveal className="mb-16 text-center" amount={0.4}>
          <h2 className="mb-2 text-4xl font-semibold tracking-[-0.03em] text-ink md:text-5xl">
            built with
          </h2>
          <p className="text-sm font-light text-muted">
            Real infrastructure, end to end
          </p>
        </ScrollReveal>

        <div className="flex flex-wrap items-center justify-center gap-6 md:gap-8">
          {builtWithLogos.map((logo, index) => (
            <ScrollReveal
              key={logo.name}
              className="flex items-center justify-center rounded-[14px] border border-line bg-card px-8 py-4 font-mono text-lg font-medium tracking-wider text-ink-dim shadow-[0_1px_2px_rgba(16,24,22,0.04)] transition-colors duration-300 hover:border-bright hover:text-forest"
              delay={index * LANDING_TIMING.logoStagger}
              direction="up"
              amount={0.2}
            >
              {logo.label}
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  )
}
