import { Activity, Landmark, FlaskConical, Lock } from 'lucide-react'
import ScrollReveal from './motion/ScrollReveal'
import { LANDING_TIMING } from './motion/landingMotion'

const workflows = [
  {
    icon: Activity,
    title: 'Portfolio monitoring',
    description:
      'Let agents watch wallets, detect changes, and act when predefined conditions are met.',
  },
  {
    icon: Landmark,
    title: 'Treasury operations',
    description:
      'Give internal agents bounded authority to move funds, rebalance capital, or pay for execution under approval rules.',
  },
  {
    icon: FlaskConical,
    title: 'Research and execution',
    description:
      'Allow agents to pay for intelligence, analyze portfolio state, and carry actions through within policy.',
  },
  {
    icon: Lock,
    title: 'Sensitive on-chain operations',
    description:
      'Handle private or approval-gated flows without exposing raw keys to the agent runtime.',
  },
]

export default function WorkflowsSection() {
  return (
    <section id="workflows" className="border-t border-line px-6 py-20 md:px-12">
      <div className="mx-auto max-w-7xl">
        <ScrollReveal className="mb-14 text-center" amount={0.4}>
          <h2 className="text-4xl font-semibold tracking-[-0.03em] text-ink md:text-5xl">
            built for real agent workflows.
          </h2>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {workflows.map((wf, index) => {
            const Icon = wf.icon
            return (
              <ScrollReveal
                key={wf.title}
                className="group flex gap-5 rounded-[20px] border border-line bg-card p-7 shadow-[0_1px_2px_rgba(16,24,22,0.04),0_4px_16px_rgba(16,24,22,0.04)] transition-all duration-300 hover:border-bright hover:shadow-[0_1px_2px_rgba(16,24,22,0.05),0_10px_28px_rgba(16,24,22,0.07)]"
                delay={index * LANDING_TIMING.itemStagger}
                direction="up"
                amount={0.3}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-pale transition-colors group-hover:bg-bright/20">
                  <Icon className="h-5 w-5 text-forest" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="mb-2 text-base font-semibold text-ink">{wf.title}</p>
                  <p className="text-sm font-light leading-relaxed text-ink-dim">
                    {wf.description}
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
