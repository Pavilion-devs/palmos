import { CheckCircle, Clock, XCircle } from 'lucide-react'
import { outcomeCards } from '../content'
import ScrollReveal from './motion/ScrollReveal'
import { LANDING_TIMING } from './motion/landingMotion'

const statusConfig = {
  green: {
    icon: CheckCircle,
    card: 'border-green-light',
    pill: 'bg-green-pale text-forest',
    dot: 'bg-bright',
    iconColor: 'text-green-2',
  },
  yellow: {
    icon: Clock,
    card: 'border-[#f2e2bf]',
    pill: 'bg-[#fdf1d6] text-[#a6711a]',
    dot: 'bg-amber',
    iconColor: 'text-amber',
  },
  red: {
    icon: XCircle,
    card: 'border-[#f3cdd3]',
    pill: 'bg-[#fbdce1] text-[#a8414f]',
    dot: 'bg-pink',
    iconColor: 'text-pink',
  },
}

export default function Testimonials() {
  return (
    <section id="outcomes" className="px-6 py-12 md:px-12">
      <ScrollReveal
        as="h2"
        className="mb-16 text-center text-4xl font-semibold tracking-[-0.03em] text-ink md:text-5xl"
        amount={0.45}
      >
        every action has an outcome
      </ScrollReveal>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-3">
        {outcomeCards.map((card, index) => {
          const config = statusConfig[card.color]
          const Icon = config.icon
          return (
            <ScrollReveal
              key={card.status}
              className={`flex h-full flex-col justify-between rounded-[22px] border ${config.card} bg-card p-8 shadow-[0_1px_2px_rgba(16,24,22,0.04),0_8px_24px_rgba(16,24,22,0.04)] transition-shadow duration-300 hover:shadow-[0_1px_2px_rgba(16,24,22,0.05),0_14px_34px_rgba(16,24,22,0.06)]`}
              delay={index * LANDING_TIMING.itemStagger}
              amount={0.35}
            >
              <div>
                <div className={`mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1 ${config.pill}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
                  <span className="text-xs font-semibold tracking-wide uppercase">
                    {card.status}
                  </span>
                </div>
                <p className="mb-2 text-lg font-semibold text-ink">{card.agent}</p>
                <p className="mb-1 text-sm font-light text-ink-dim">{card.action}</p>
                <p className="mb-6 font-mono text-2xl font-medium text-ink">{card.amount}</p>
              </div>
              <div className="flex items-center gap-3 border-t border-line pt-6">
                <Icon className={`h-4 w-4 shrink-0 ${config.iconColor}`} strokeWidth={1.75} />
                <span className="text-sm font-light text-muted">{card.policy}</span>
              </div>
            </ScrollReveal>
          )
        })}
      </div>
    </section>
  )
}
