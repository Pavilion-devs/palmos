import { Check } from 'lucide-react'
import SectionFrame from './SectionFrame'
import { steps, settlementRails, CONSOLE_URL } from './landingData'

const TAG =
  'inline-flex w-fit border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-white/50 mb-6 scroll-fade-in'
const TITLE =
  'text-xl md:text-2xl font-light tracking-tighter text-white mb-3 scroll-fade-in'
const DESC =
  'text-sm leading-relaxed tracking-tight text-white/50 scroll-fade-in'
const CARD = 'flashlight-target scroll-fade-in border-r border-b border-white/15'
const BODY = 'flashlight-content group relative flex flex-col p-8 md:p-10'

export default function HowItWorks() {
  return (
    <SectionFrame id="how-it-works" className="z-10 px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mb-16 flex flex-col items-center text-center">
          <div className="scroll-fade-in mb-6 inline-flex items-center gap-2 border border-lime/30 bg-lime/5 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-lime">
            Governed by design
          </div>
          <h2 className="scroll-fade-in mb-6 text-balance text-3xl font-light tracking-tighter text-white md:text-5xl">
            From key to settlement, governed
          </h2>
          <p className="scroll-fade-in mb-8 max-w-2xl text-pretty text-base tracking-tight text-white/50 md:text-lg">
            Provision a wallet, set the rules, and let the agent act within them.
            Every sensitive move escalates to you — and every decision is logged.
          </p>
          <a
            href={CONSOLE_URL}
            className="scroll-fade-in inline-flex items-center gap-2 bg-lime px-8 py-3.5 text-sm font-semibold tracking-tight text-black transition-colors hover:bg-lime-hover"
          >
            Get started
          </a>
        </div>

        <div className="grid grid-cols-1 border-l border-t border-white/15 md:grid-cols-2">
          {/* Step 01 — Provision */}
          <div className={CARD}>
            <div className={BODY}>
              <div className={TAG}>{steps[0].step}</div>
              <h3 className={TITLE}>{steps[0].title}</h3>
              <p className={DESC}>{steps[0].description}</p>
              <div className="scroll-fade-in mt-8 grid grid-cols-1 gap-px border border-white/10 bg-white/10 sm:grid-cols-2">
                <div className="bg-white/5 p-5 backdrop-blur-md">
                  <div className="space-y-3">
                    {[
                      { label: 'Treasury wallet', active: true },
                      { label: 'Trading wallet', active: false },
                      { label: 'Research wallet', active: false },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center gap-3 border border-white/10 bg-white/10 p-2.5"
                      >
                        <span
                          className={`size-3 ${item.active ? 'bg-lime' : 'bg-white/20'}`}
                        />
                        <span className="font-mono text-xs text-white/70">
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex min-h-[140px] flex-col items-center justify-center bg-white/5 p-5 backdrop-blur-md">
                  <div className="flex size-10 items-center justify-center rounded-full border border-lime/30 bg-lime/10 text-lime">
                    <Check className="size-5" strokeWidth={2.5} />
                  </div>
                  <span className="mt-3 text-center font-mono text-xs leading-relaxed text-white/50">
                    Wallet provisioned
                    <br />
                    keys in OWS
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Step 02 — Set the policy */}
          <div className={CARD}>
            <div className={BODY}>
              <div className={TAG}>{steps[1].step}</div>
              <h3 className={TITLE}>{steps[1].title}</h3>
              <p className={DESC}>{steps[1].description}</p>
              <div className="scroll-fade-in mt-8 border border-white/10 bg-white/5 p-5 backdrop-blur-md">
                <div className="space-y-5">
                  {[
                    { name: 'spend_cap', width: 'w-2/3', bar: 'bg-lime', value: '500', valueColor: 'text-lime' },
                    { name: 'vendor_allow', width: 'w-1/2', bar: 'bg-white/40', value: '12', valueColor: 'text-white/80' },
                    { name: 'auto_approve', width: 'w-3/4', bar: 'bg-white/40', value: '0.10', valueColor: 'text-white/80' },
                  ].map((row) => (
                    <div key={row.name} className="flex items-center gap-4">
                      <div className="w-24 font-mono text-[10px] text-white/40">
                        {row.name}
                      </div>
                      <div className="relative h-1 flex-1 bg-white/10">
                        <div className={`absolute left-0 top-0 h-1 ${row.bar} ${row.width}`} />
                      </div>
                      <div className={`w-12 text-right font-mono text-[10px] ${row.valueColor}`}>
                        {row.value}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
                  <div className="font-mono text-[10px] text-white/40">
                    Status:<span className="ml-1 text-lime">Policy valid</span>
                  </div>
                  <div className="h-1 w-16 bg-gradient-to-r from-lime/20 to-lime" />
                </div>
              </div>
            </div>
          </div>

          {/* Step 03 — Agent executes */}
          <div className={CARD}>
            <div className={BODY}>
              <div className={TAG}>{steps[2].step}</div>
              <h3 className={TITLE}>{steps[2].title}</h3>
              <p className={DESC}>{steps[2].description}</p>
              <div className="scroll-fade-in mt-8 space-y-3">
                <div className="flex flex-col gap-3 border border-white/10 bg-white/5 p-4 backdrop-blur-md">
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-white/50">
                      Proposed transaction
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="size-1.5 animate-pulse bg-lime" />
                      <span className="font-mono text-[10px] text-lime">
                        Within policy
                      </span>
                    </div>
                  </div>
                  <div className="relative flex aspect-[21/9] items-center justify-center overflow-hidden border border-white/5 bg-white/10 p-4">
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:20px_20px]" />
                    <div className="relative z-10 flex w-full max-w-xs flex-col gap-2 border border-lime/30 bg-lime/5 p-3 shadow-[0_0_20px_rgba(198,249,78,0.05)]">
                      <div className="font-mono text-[10px] text-lime">
                        swap · 12,000 USDC → ETH
                      </div>
                      <div className="h-1 w-full bg-white/20" />
                      <div className="h-1 w-2/3 bg-white/20" />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center justify-between border border-white/10 bg-white/5 p-3 backdrop-blur-md">
                    <span className="font-mono text-[10px] text-white/50">Signer</span>
                    <span className="text-xs text-white">OWS vault</span>
                  </div>
                  <div className="flex items-center justify-between border border-white/10 bg-white/5 p-3 backdrop-blur-md">
                    <span className="font-mono text-[10px] text-white/50">Route</span>
                    <span className="text-xs text-lime">Byreal</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Step 04 — Govern & audit */}
          <div className={CARD}>
            <div className={BODY}>
              <div className={TAG}>{steps[3].step}</div>
              <h3 className={TITLE}>{steps[3].title}</h3>
              <p className={DESC}>{steps[3].description}</p>
              <div className="scroll-fade-in mt-8 flex flex-col gap-px border border-white/10 bg-white/10">
                {settlementRails.map((rail) => (
                  <div
                    key={rail.name}
                    className="flex items-center justify-between bg-white/5 p-3 backdrop-blur-md md:p-4"
                  >
                    <div>
                      <div className="mb-1 font-mono text-xs text-white">
                        {rail.name}
                      </div>
                      <div className="text-[10px] tracking-tight text-white/40">
                        {rail.note}
                      </div>
                    </div>
                    <span
                      className={
                        rail.primary
                          ? 'bg-lime px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-black'
                          : 'border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/70'
                      }
                    >
                      {rail.primary ? 'Settling' : 'Logged'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SectionFrame>
  )
}
