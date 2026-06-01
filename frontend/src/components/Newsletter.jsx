import { ArrowRight } from 'lucide-react'
import ScrollReveal from './motion/ScrollReveal'

export default function Newsletter({ waitlistUrl }) {
  return (
    <section className="px-6 py-24 md:px-12">
      <ScrollReveal
        className="relative mx-auto max-w-4xl overflow-hidden rounded-[28px] bg-green-pale px-6 py-20 text-center"
        amount={0.45}
      >
        <div className="relative z-10">
          <h2 className="mb-4 text-4xl font-semibold tracking-[-0.03em] text-ink md:text-5xl">
            ready to take control?
          </h2>
          <p className="mb-10 text-lg font-light text-ink-dim md:text-xl">
            See agent spend governance in action
          </p>

          <a
            href={waitlistUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex w-full max-w-xs cursor-pointer items-center justify-center gap-2 rounded-full bg-forest px-8 py-4 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(20,89,58,0.22)] transition-colors hover:bg-green-2"
          >
            <span>Join the waitlist</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2} />
          </a>
        </div>

        <div className="pointer-events-none absolute top-1/2 left-1/2 -z-0 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-bright/15 blur-[100px]" />
      </ScrollReveal>
    </section>
  )
}
