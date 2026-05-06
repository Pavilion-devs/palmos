import { CheckCircle, Clock, XCircle } from 'lucide-react'
import { outcomeCards } from '../content'

const statusConfig = {
  green: { icon: CheckCircle, border: 'border-green-500/30', dot: 'bg-green-500', text: 'text-green-400' },
  yellow: { icon: Clock, border: 'border-yellow-500/30', dot: 'bg-yellow-500', text: 'text-yellow-400' },
  red: { icon: XCircle, border: 'border-red-500/30', dot: 'bg-red-500', text: 'text-red-400' },
}

export default function Testimonials() {
  return (
    <section id="outcomes" className="px-6 py-12 md:px-12">
      <h2 className="mb-16 text-center text-4xl font-medium tracking-tighter md:text-5xl">
        three policy paths
      </h2>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {outcomeCards.map((card) => {
          const config = statusConfig[card.color]
          const Icon = config.icon
          return (
            <div
              key={card.status}
              className={`flex h-full flex-col justify-between border ${config.border} bg-neutral-900/20 p-8 transition-colors duration-300 hover:border-neutral-600`}
            >
              <div>
                <div className="mb-6 flex items-center gap-3">
                  <div className={`h-2 w-2 rounded-full ${config.dot}`} />
                  <span className={`text-sm font-medium uppercase tracking-widest ${config.text}`}>
                    {card.status}
                  </span>
                </div>
                <p className="mb-2 text-lg font-medium text-white">{card.agent}</p>
                <p className="mb-1 text-sm font-light text-neutral-400">{card.action}</p>
                <p className="mb-6 font-mono text-2xl font-medium text-white">{card.amount}</p>
              </div>
              <div className="flex items-center gap-3 border-t border-neutral-800/50 pt-6">
                <Icon className={`h-4 w-4 ${config.text}`} strokeWidth={1.5} />
                <span className="text-sm font-light text-neutral-500">{card.policy}</span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
