import { BarChart2, ArrowRightLeft, ShieldAlert, EyeOff } from 'lucide-react'
import ScrollReveal from './motion/ScrollReveal'
import { LANDING_TIMING } from './motion/landingMotion'

const capabilities = [
  {
    icon: BarChart2,
    title: 'Understand portfolios',
    description:
      'Read balances, positions, chain exposure, and wallet activity before taking action.',
  },
  {
    icon: ArrowRightLeft,
    title: 'Propose and execute actions',
    description:
      'Request or carry out transfers, trades, rebalances, and operational payments within defined scope.',
  },
  {
    icon: ShieldAlert,
    title: 'Escalate sensitive moves',
    description:
      'Route high-risk or high-value actions to operator approval instead of letting them execute blindly.',
  },
  {
    icon: EyeOff,
    title: 'Use privacy when needed',
    description:
      'Turn on private execution paths for workflows that should not broadcast the full payout trail.',
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

        <ScrollReveal className="mb-14 text-center" amount={0.35}>
          <p className="mx-auto max-w-2xl text-lg font-light text-ink-dim">
            PalmOS is not just a wallet viewer. It gives agents a controlled path to understand
            portfolio state and take useful on-chain actions inside policy.
          </p>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {capabilities.map((cap, index) => {
            const Icon = cap.icon
            return (
              <ScrollReveal
                key={cap.title}
                className="flex flex-col gap-4 rounded-[20px] border border-line bg-card p-7 shadow-[0_1px_2px_rgba(16,24,22,0.04),0_4px_16px_rgba(16,24,22,0.04)] transition-shadow duration-300 hover:shadow-[0_1px_2px_rgba(16,24,22,0.05),0_10px_28px_rgba(16,24,22,0.07)]"
                delay={index * LANDING_TIMING.itemStagger}
                direction="up"
                amount={0.35}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-pale">
                  <Icon className="h-5 w-5 text-forest" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="mb-2 text-base font-semibold text-ink">{cap.title}</p>
                  <p className="text-sm font-light leading-relaxed text-ink-dim">
                    {cap.description}
                  </p>
                </div>
              </ScrollReveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
