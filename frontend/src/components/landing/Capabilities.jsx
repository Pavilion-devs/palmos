import {
  Wallet,
  EyeOff,
  Repeat,
  LineChart,
  BadgeCheck,
  SlidersHorizontal,
  ArrowRight,
} from 'lucide-react'
import SectionFrame from './SectionFrame'
import { capabilities, WAITLIST_URL } from './landingData'

const ICONS = {
  Wallet,
  EyeOff,
  Repeat,
  LineChart,
  BadgeCheck,
  SlidersHorizontal,
}

function CapabilityCard({ card }) {
  const Icon = ICONS[card.icon] ?? Wallet
  return (
    <div className="flashlight-target scroll-fade-in group/card h-full">
      <div className="flashlight-content relative flex h-full flex-col border border-white/10 bg-zinc-950 p-6 transition-colors hover:border-white/20">
        <div className="mb-5 flex items-start justify-between">
          <div className="flex size-11 items-center justify-center border border-white/10 bg-background text-white/70 transition-colors group-hover/card:border-lime/30 group-hover/card:text-lime">
            <Icon className="size-5" strokeWidth={1.75} />
          </div>
          <div className="flex items-center gap-2">
            {card.badge && (
              <span className="border border-lime/30 bg-lime/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-lime">
                {card.badge}
              </span>
            )}
            <span className="font-mono text-xs tracking-widest text-white/40">
              {card.index}
            </span>
          </div>
        </div>

        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-white/40">
          {card.category}
        </div>
        <h3 className="text-lg font-light tracking-tighter text-white">
          {card.title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed tracking-tight text-white/50">
          {card.description}
        </p>

        <div className="my-5 h-px w-full bg-white/5" />
        <div className="mt-auto flex items-center justify-between">
          <span className="flex items-center gap-2 font-mono text-[11px] text-white/40">
            <span className="size-1.5 rounded-full bg-lime" /> Available
          </span>
          <ArrowRight className="size-4 text-white/30 transition-all group-hover/card:translate-x-1 group-hover/card:text-lime" />
        </div>
      </div>
    </div>
  )
}

export default function Capabilities() {
  return (
    <SectionFrame id="capabilities" className="z-10 px-6 py-20">
      <div className="mb-12 flex flex-col justify-between gap-6 scroll-fade-in md:flex-row md:items-end">
        <div>
          <h2 className="mb-3 text-2xl font-light tracking-tighter text-white md:text-3xl">
            What your agents can do
          </h2>
          <p className="max-w-md text-sm tracking-tight text-white/50">
            Every capability runs inside your policy — proposed by the agent,
            signed by your vault, logged on-chain.
          </p>
        </div>
        <a
          href={WAITLIST_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 border border-lime/30 bg-lime/5 px-4 py-2 text-xs font-medium tracking-tight text-lime transition-colors hover:bg-lime/10 scroll-fade-in"
        >
          Get early access <ArrowRight className="size-4" />
        </a>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {capabilities.map((card) => (
          <CapabilityCard key={card.index} card={card} />
        ))}
      </div>
    </SectionFrame>
  )
}
