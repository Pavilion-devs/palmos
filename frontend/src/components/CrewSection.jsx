import { builtWithLogos } from '../content'

export default function CrewSection() {
  return (
    <section id="built-with" className="relative overflow-hidden border-neutral-900 border-t pt-24 pr-6 pb-24 pl-6 md:px-12">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 text-center">
          <h2 className="mb-2 text-4xl font-medium tracking-tighter text-white md:text-5xl">
            built with
          </h2>
          <p className="text-sm font-light text-neutral-500">
            Powered by the hackathon stack
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-16">
          {builtWithLogos.map((logo) => (
            <div
              key={logo.name}
              className="flex items-center justify-center rounded border border-neutral-800 bg-neutral-900/30 px-8 py-4 font-mono text-lg font-medium tracking-wider text-neutral-400 transition-colors duration-300 hover:border-neutral-600 hover:text-white"
            >
              {logo.label}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
