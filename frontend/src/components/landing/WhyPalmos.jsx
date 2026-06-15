import {
  Lock,
  SlidersHorizontal,
  ScrollText,
  Zap,
  Wallet,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react'
import SectionFrame from './SectionFrame'
import { features } from './landingData'

const ICONS = { Lock, SlidersHorizontal, ScrollText, Zap }
const CARD =
  'relative flex flex-col border border-white/10 bg-background p-6 md:p-8 transition-colors hover:border-white/20 group shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] scroll-fade-in'

function Caption({ icon, title, description }) {
  const Icon = ICONS[icon] ?? Lock
  return (
    <div className="relative z-10 mt-auto">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-5 text-lime" strokeWidth={1.75} />
        <h3 className="text-xl font-light tracking-tighter text-white md:text-2xl">
          {title}
        </h3>
      </div>
      <p className="max-w-md text-sm leading-relaxed tracking-tight text-white/45">
        {description}
      </p>
    </div>
  )
}

export default function WhyPalmos() {
  return (
    <SectionFrame id="why" className="z-10 overflow-hidden px-6 py-32">
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-lime/5 blur-[140px]" />

      <div className="relative z-10 mx-auto max-w-6xl">
        <div className="mb-20 flex flex-col items-center text-center">
          <div className="scroll-fade-in mb-6 inline-flex items-center gap-2 border border-lime/30 bg-lime/5 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-lime">
            The advantage
          </div>
          <h2 className="scroll-fade-in mb-6 text-balance text-4xl font-light tracking-tighter text-white md:text-5xl lg:text-6xl">
            Built for control,
            <br className="hidden md:block" /> not custody.
          </h2>
          <p className="scroll-fade-in max-w-2xl text-pretty text-base tracking-tight text-white/50 md:text-lg">
            Give autonomous agents real spending power without handing over the
            keys — and prove every move after the fact.
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-6 md:auto-rows-[420px] md:grid-cols-12">
          {/* Non-custodial — vault visual */}
          <div className={`md:col-span-7 ${CARD}`}>
            <div className="relative mb-8 flex flex-1 items-center justify-center overflow-hidden border border-white/10 bg-panel shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:32px_32px]" />
              <div className="relative z-10 flex items-center gap-6">
                <div className="flex flex-col items-center gap-2">
                  <div className="flex size-16 items-center justify-center rounded-2xl border border-lime/30 bg-lime/10 text-lime shadow-[0_0_30px_rgba(198,249,78,0.15)] transition-transform duration-500 group-hover:scale-105">
                    <Lock className="size-7" strokeWidth={1.75} />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-lime">
                    OWS vault
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <div className="h-px w-16 bg-gradient-to-r from-lime/50 to-white/10" />
                  <span className="mt-1 font-mono text-[9px] text-white/30">
                    authority only
                  </span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <div className="flex size-16 items-center justify-center rounded-2xl border border-white/10 bg-background text-white/60">
                    <Wallet className="size-7" strokeWidth={1.75} />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">
                    Agent
                  </span>
                </div>
              </div>
            </div>
            <Caption {...features[0]} />
          </div>

          {/* Structured policies — JSON window */}
          <div className={`md:col-span-5 ${CARD}`}>
            <div className="relative mb-8 flex flex-1 items-center justify-center overflow-hidden border border-white/10 bg-panel shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]">
              <div className="relative z-10 w-full max-w-[260px] border border-white/10 bg-background shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] transition-transform duration-500 group-hover:-translate-y-2">
                <div className="flex items-center gap-1.5 border-b border-white/5 bg-panel px-3 py-2">
                  <span className="size-2 bg-white/20" />
                  <span className="size-2 bg-white/20" />
                  <span className="size-2 bg-white/20" />
                </div>
                <div className="p-5 font-mono text-[11px] leading-loose text-white/80 md:text-xs">
                  <div>
                    <span className="text-lime">&quot;spend_cap&quot;</span>:{' '}
                    <span className="text-white">500</span>,
                  </div>
                  <div>
                    <span className="text-lime">&quot;vendors&quot;</span>:{' '}
                    <span className="text-white">&quot;allowlist&quot;</span>,
                  </div>
                  <div>
                    <span className="text-lime">&quot;escalate&quot;</span>: {'{'}
                  </div>
                  <div className="pl-4">
                    <span className="text-lime">&quot;over&quot;</span>:{' '}
                    <span className="text-white">0.10</span>
                  </div>
                  <div>{'}'}</div>
                </div>
              </div>
            </div>
            <Caption {...features[1]} />
          </div>

          {/* Full audit trail — log lines */}
          <div className={`md:col-span-5 ${CARD}`}>
            <div className="relative mb-8 flex flex-1 items-center justify-center overflow-hidden border border-white/10 bg-panel p-5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:20px_20px]" />
              <div className="relative z-10 w-full max-w-[280px] space-y-2">
                {[
                  { tone: 'text-emerald-400', label: 'approved', hash: '0x9f…a1' },
                  { tone: 'text-amber-400', label: 'pending', hash: '0x3c…7d' },
                  { tone: 'text-rose-400', label: 'blocked', hash: '0x12…ff' },
                ].map((row) => (
                  <div
                    key={row.hash}
                    className="flex items-center justify-between border border-white/10 bg-background px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`size-1.5 rounded-full ${row.tone} bg-current`} />
                      <span className="font-mono text-[10px] uppercase tracking-wider text-white/60">
                        {row.label}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-white/30">
                      {row.hash}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-center gap-2 pt-1 font-mono text-[10px] text-lime">
                  <ShieldCheck className="size-3.5" strokeWidth={2} /> written on-chain
                </div>
              </div>
            </div>
            <Caption {...features[2]} />
          </div>

          {/* Real settlement — flow */}
          <div className={`md:col-span-7 ${CARD}`}>
            <div className="relative mb-8 flex flex-1 flex-col items-center justify-center overflow-hidden border border-white/10 bg-panel p-6 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]">
              <div className="relative z-10 flex w-full max-w-sm flex-col gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex size-10 items-center justify-center border border-white/10 bg-background text-white/60">
                    <Wallet className="size-5" strokeWidth={1.75} />
                  </div>
                  <div className="relative h-px flex-1 bg-gradient-to-r from-white/10 to-lime/50">
                    <span className="absolute right-0 top-1/2 size-2 -translate-y-1/2 bg-lime shadow-[0_0_12px_#c6f94e]" />
                  </div>
                  <div className="flex size-10 items-center justify-center border border-lime/30 bg-lime/10 text-lime">
                    <SlidersHorizontal className="size-5" strokeWidth={1.75} />
                  </div>
                  <div className="relative h-px flex-1 bg-gradient-to-r from-lime/50 to-white/10">
                    <span className="absolute right-0 top-1/2 size-2 -translate-y-1/2 bg-white/50" />
                  </div>
                  <div className="flex size-10 items-center justify-center border border-white/10 bg-background text-white/60 transition-all duration-700 group-hover:border-lime/50 group-hover:text-lime">
                    <Zap className="size-5" strokeWidth={1.75} />
                  </div>
                </div>
                <div className="relative mt-4 overflow-hidden border border-white/10 bg-background p-3">
                  <div className="absolute inset-y-0 left-0 w-0 bg-lime/10 transition-all duration-1000 ease-in-out group-hover:w-full" />
                  <div className="relative z-10 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">
                      propose → approve
                    </span>
                    <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-lime">
                      <span className="size-1.5 animate-pulse bg-lime" /> settled
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <Caption {...features[3]} />
          </div>
        </div>
      </div>
    </SectionFrame>
  )
}
