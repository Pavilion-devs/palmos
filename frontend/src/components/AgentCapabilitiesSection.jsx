import { ArrowUpRight } from 'lucide-react'
import ScrollReveal from './motion/ScrollReveal'
import { LANDING_TIMING } from './motion/landingMotion'

const capabilities = [
  {
    title: 'Understand portfolios',
    description:
      'Read balances, positions, chain exposure, and wallet activity before taking action.',
    cta: 'Explore portfolio context',
    image: null,
    gradient: 'from-[#0d2b1a] via-[#14532d] to-[#1a7a42]',
  },
  {
    title: 'Propose and execute',
    description:
      'Request or carry out transfers, trades, rebalances, and operational payments within defined scope.',
    cta: 'See execution controls',
    image: null,
    gradient: 'from-[#0a2540] via-[#0e4a6e] to-[#0e7490]',
  },
  {
    title: 'Escalate sensitive moves',
    description:
      'Route high-risk or high-value actions to operator approval instead of letting them execute blindly.',
    cta: 'View approval flow',
    image: null,
    gradient: 'from-[#1a0a2e] via-[#3b0764] to-[#6b21a8]',
  },
  {
    title: 'Use privacy when needed',
    description:
      'Turn on private execution paths for workflows that should not broadcast the full payout trail.',
    cta: 'Learn about private settlement',
    image: null,
    gradient: 'from-[#0a0a0f] via-[#111827] to-[#1e293b]',
  },
]

export default function AgentCapabilitiesSection() {
  return (
    <section id="product" className="px-6 py-20 md:px-12">
      <div className="mx-auto max-w-7xl">

        <ScrollReveal className="mb-4 text-center" amount={0.4}>
          <h2 className="text-4xl font-semibold tracking-[-0.03em] text-ink md:text-5xl">
            let agents act. keep them bounded.
          </h2>
        </ScrollReveal>

        <ScrollReveal className="mb-16 text-center" amount={0.35}>
          <p className="mx-auto max-w-2xl text-lg font-light text-ink-dim">
            PalmOS is not just a wallet viewer. It gives agents a controlled path to understand
            portfolio state and take useful on-chain actions inside policy.
          </p>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
          {capabilities.map((cap, index) => (
            <ScrollReveal
              key={cap.title}
              delay={index * LANDING_TIMING.itemStagger}
              direction="up"
              amount={0.25}
            >
              {/* Image area */}
              <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${cap.gradient} aspect-[16/9]`}>
                {cap.image ? (
                  <img
                    src={cap.image}
                    alt={cap.title}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>

              {/* Content below image */}
              <div className="mt-6 px-1">
                <h3 className="text-xl font-bold text-ink">{cap.title}</h3>
                <p className="mt-2 text-sm font-light leading-relaxed text-ink-dim">
                  {cap.description}
                </p>
                <a
                  href="#product"
                  className="group mt-5 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-forest transition-colors hover:text-green-2"
                >
                  {cap.cta}
                  <ArrowUpRight
                    className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    strokeWidth={2}
                  />
                </a>
              </div>
            </ScrollReveal>
          ))}
        </div>

      </div>
    </section>
  )
}
