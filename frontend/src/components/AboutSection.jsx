import ScrollReveal from './motion/ScrollReveal'

export default function AboutSection() {
  return (
    <ScrollReveal
      as="section"
      className="mx-auto max-w-4xl px-6 py-20 text-center md:px-12 md:py-32"
      amount={0.35}
    >
      <h2 className="mb-8 text-4xl font-medium tracking-tighter md:text-6xl">
        the problem
      </h2>
      <p className="mx-auto max-w-3xl text-xl leading-relaxed font-light text-neutral-400 md:text-2xl">
        AI agents are getting wallets.{' '}
        <span className="text-white">Palm USD gives them a settlement asset.</span>{' '}
        PalmOS gives teams the operator layer on top.
      </p>
    </ScrollReveal>
  )
}
