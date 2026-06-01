import { Check } from 'lucide-react'
import ScrollReveal from './motion/ScrollReveal'
import { LANDING_TIMING } from './motion/landingMotion'

const controls = [
  'Spend limits',
  'Allowed assets',
  'Allowed chains',
  'Allowed protocols & counterparties',
  'Approval thresholds',
  'Expiry windows',
  'Privacy mode',
  'Full audit visibility',
]

export default function OperatorControlsSection() {
  return (
    <section id="controls" className="px-6 py-20 md:px-12">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:items-center">

          <ScrollReveal amount={0.35} direction="up">
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-forest">
              Operator controls
            </p>
            <h2 className="mb-6 text-4xl font-semibold tracking-[-0.03em] text-ink md:text-5xl">
              rules before execution.
            </h2>
            <p className="mb-8 text-lg font-light leading-relaxed text-ink-dim">
              Agents can only do what operators explicitly allow. PalmOS puts policy, permissions,
              and approval logic between the agent and real asset movement.
            </p>
            <p className="text-base font-medium text-forest">
              The result is useful financial authority without unrestricted keys.
            </p>
          </ScrollReveal>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {controls.map((control, index) => (
              <ScrollReveal
                key={control}
                className="flex items-center gap-3 rounded-[14px] border border-line bg-card px-5 py-4 shadow-[0_1px_2px_rgba(16,24,22,0.04)]"
                delay={index * LANDING_TIMING.itemStagger}
                direction="up"
                amount={0.25}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-pale">
                  <Check className="h-3 w-3 text-forest" strokeWidth={2.5} />
                </span>
                <span className="text-sm font-medium text-ink">{control}</span>
              </ScrollReveal>
            ))}
          </div>

        </div>
      </div>
    </section>
  )
}
