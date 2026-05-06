import { ArrowRight } from 'lucide-react'

export default function Newsletter() {
  return (
    <section className="relative border-neutral-900 border-t pt-24 pr-6 pb-24 pl-6 md:px-12">
      <div className="relative z-10 mx-auto max-w-2xl px-6 text-center">
        <h2 className="mb-4 text-4xl font-medium tracking-tighter text-white md:text-5xl">
          ready to take control?
        </h2>
        <p className="mb-10 text-lg font-light text-neutral-400 md:text-xl">
          See agent spend governance in action
        </p>

        <a
          href="#dashboard"
          className="group inline-flex w-full max-w-md items-center justify-center gap-3 border border-white bg-white px-8 py-4 text-sm font-medium tracking-widest uppercase text-black transition-colors hover:bg-neutral-200"
        >
          <span>Open Dashboard</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={1.5} />
        </a>
      </div>

      <div className="pointer-events-none absolute top-1/2 left-1/2 -z-0 h-full max-h-lg w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5 opacity-50 blur-[100px]" />
    </section>
  )
}
