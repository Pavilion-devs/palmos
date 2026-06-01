import { ArrowRight, Play } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { LANDING_SPRING } from './motion/landingMotion'

const HERO_REVEAL = {
  y: 22,
  blur: '10px',
}

const MotionDiv = motion.div
const MotionHeading = motion.h1
const MotionParagraph = motion.p
const MotionA = motion.a

const DEMO_URL = 'https://x.com/olathepavilion/status/2054172802278682936?s=20'

export default function Hero({ waitlistUrl }) {
  const prefersReducedMotion = useReducedMotion()
  const revealProps = (delay) => {
    if (prefersReducedMotion) return {}

    return {
      initial: { opacity: 0, y: HERO_REVEAL.y, filter: `blur(${HERO_REVEAL.blur})` },
      animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
      transition: { ...LANDING_SPRING, delay },
    }
  }

  return (
    <section className="hero-field relative isolate flex min-h-[92vh] flex-col items-center justify-center overflow-hidden px-6 pt-32 pb-24 text-center md:px-12 md:pt-40">
      <MotionDiv className="palm-hero-mark" aria-hidden="true" {...revealProps(0)}>
        <span className="palm-stem" />
        {Array.from({ length: 9 }).map((_, index) => (
          <span key={index} className={`palm-leaf palm-leaf-${index + 1}`} />
        ))}
      </MotionDiv>

      <MotionHeading
        className="mx-auto max-w-5xl text-5xl leading-[0.95] font-extrabold tracking-[-0.045em] text-white md:text-7xl lg:text-8xl"
        {...revealProps(0.1)}
      >
        Give agents a wallet.{' '}
        <br className="hidden md:block" />
        Keep the{' '}
        <span className="bg-gradient-to-br from-[#e8f3ec] via-[#7fd3a8] to-[#2ea86b] bg-clip-text text-transparent">
          keys
        </span>
        .
      </MotionHeading>

      <MotionParagraph
        className="mt-7 max-w-2xl text-lg leading-relaxed font-light text-green-light/70 md:text-xl"
        {...revealProps(0.22)}
      >
        AI agent wallets with built-in controls. Set limits, approve sensitive
        actions, and audit every on-chain move. No raw keys, ever.
      </MotionParagraph>

      <MotionDiv
        className="mt-11 flex flex-col items-center gap-3 sm:flex-row"
        {...revealProps(0.34)}
      >
        <MotionA
          href={waitlistUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-8 py-4 text-base font-semibold text-ink shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-colors hover:bg-green-pale sm:w-auto"
          whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
        >
          <span>Get started</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2} />
        </MotionA>

        <a
          href={DEMO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-white/30 px-8 py-4 text-base font-semibold text-white/80 transition-colors hover:border-white/60 hover:text-white sm:w-auto"
        >
          <Play className="h-4 w-4 fill-current" strokeWidth={0} />
          <span>Watch demo</span>
        </a>
      </MotionDiv>
    </section>
  )
}
