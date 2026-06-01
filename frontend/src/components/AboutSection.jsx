import ScrollReveal from './motion/ScrollReveal'

export default function AboutSection() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20 text-center md:px-12 md:py-32">
      <ScrollReveal amount={0.35}>
        <h2 className="mb-8 text-4xl font-semibold tracking-[-0.03em] text-ink md:text-6xl">
          a command center for agent wallet operations
        </h2>
        <p className="mx-auto max-w-3xl text-xl leading-relaxed font-light text-ink-dim md:text-2xl">
          PalmOS gives AI agents a governed way to operate wallets and portfolios.{' '}
          <span className="font-medium text-forest">Agents understand balances, positions, and on-chain activity.</span>{' '}
          Operators set the rules for what can execute.
        </p>
      </ScrollReveal>

      <ScrollReveal className="mt-16" amount={0.25} direction="up">
        <div className="overflow-hidden rounded-2xl border border-line shadow-[0_8px_40px_rgba(16,24,22,0.08)]">
          <video
            src="/main-web.mp4"
            autoPlay
            muted
            loop
            playsInline
            className="w-full"
          />
        </div>
      </ScrollReveal>
    </section>
  )
}
