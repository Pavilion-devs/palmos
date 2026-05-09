import { Wallet, ShieldCheck, Eye } from 'lucide-react'
import { howItWorksSteps } from '../content'
import ScrollReveal from './motion/ScrollReveal'
import { LANDING_TIMING } from './motion/landingMotion'

const iconMap = {
  Wallet,
  ShieldCheck,
  Eye,
}

export default function ProcessSection() {
  return (
    <section id="how-it-works" className="px-6 py-20 md:px-12">
      <div className="grid grid-cols-1 gap-12 border-t border-neutral-800 pt-12 md:grid-cols-3 md:gap-8">
        {howItWorksSteps.map((col, index) => {
          const Icon = iconMap[col.icon]
          return (
            <ScrollReveal
              key={col.step}
              className="group"
              delay={index * LANDING_TIMING.itemStagger}
              direction="up"
              amount={0.4}
            >
              <div className="mb-6 flex items-center gap-3 text-neutral-500">
                <span className="rounded border border-neutral-800 px-1.5 py-0.5 font-mono text-xs">
                  {col.step}
                </span>
                <h3 className="text-sm font-medium tracking-widest text-white uppercase">
                  {col.title}
                </h3>
              </div>
              <div className="flex items-center gap-4 transition-transform duration-300 group-hover:translate-x-2">
                {Icon && (
                  <Icon
                    className="h-8 w-8 text-neutral-600 transition-colors group-hover:text-white"
                    strokeWidth={1.5}
                  />
                )}
                <span className="text-2xl font-medium tracking-tight text-neutral-300 group-hover:text-white md:text-3xl">
                  {col.description}
                </span>
              </div>
            </ScrollReveal>
          )
        })}
      </div>
    </section>
  )
}
