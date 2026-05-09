import { ArrowRight } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { LANDING_SPRING, LANDING_TIMING } from './motion/landingMotion'

const HERO_REVEAL = {
  y: 22,
  blur: '10px',
}

const MotionDiv = motion.div
const MotionHeading = motion.h1
const MotionParagraph = motion.p
const MotionButton = motion.button

export default function Hero({ onGetStarted }) {
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
    <section className="relative flex min-h-[80vh] flex-col items-center justify-center px-6 text-center md:px-12">
      <div className="pointer-events-none absolute top-0 left-0 -z-10 h-full w-full overflow-hidden opacity-30">
        <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-neutral-900 blur-[128px]" />
        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-neutral-800 blur-[128px]" />
      </div>

      <MotionDiv className="palm-hero-mark" aria-hidden="true" {...revealProps(LANDING_TIMING.heroMark)}>
        <span className="palm-stem" />
        {Array.from({ length: 9 }).map((_, index) => (
          <span key={index} className={`palm-leaf palm-leaf-${index + 1}`} />
        ))}
      </MotionDiv>

      <MotionHeading
        className="text-glow mx-auto max-w-6xl text-6xl leading-[0.9] font-black tracking-tighter md:text-8xl lg:text-9xl"
        {...revealProps(LANDING_TIMING.heroTitle)}
      >
        Give agents wallets, <br className="hidden md:block" />
        <span className="font-quicksand text-neutral-400 italic">not</span> blank
        checks.
      </MotionHeading>

      <MotionParagraph
        className="mt-6 text-xs tracking-[0.2em] text-neutral-500 uppercase md:text-sm"
        {...revealProps(LANDING_TIMING.heroEyebrow)}
      >
        Palm USD x Solana agent payment governance
      </MotionParagraph>

      <MotionParagraph
        className="mt-8 max-w-2xl text-lg font-light text-neutral-400 md:text-xl"
        {...revealProps(LANDING_TIMING.heroBody)}
      >
        PalmOS lets autonomous AI workers pay APIs and services in Palm USD while
        enforcing budgets, vendor allowlists, approvals, and audit trails.
      </MotionParagraph>

      <MotionButton
        type="button"
        onClick={onGetStarted}
        className="group mt-12 flex cursor-pointer items-center gap-2 border border-white/20 px-8 py-4 text-sm font-medium tracking-widest uppercase transition-all duration-300 hover:bg-white hover:text-black"
        whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
        {...revealProps(LANDING_TIMING.heroCta)}
      >
        <span>Get started</span>
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={1.5} />
      </MotionButton>
    </section>
  )
}
