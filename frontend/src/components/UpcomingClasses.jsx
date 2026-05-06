import { ArrowRight } from 'lucide-react'

export default function UpcomingClasses() {
  return (
    <section className="px-6 py-12 md:px-12">
      <h2 className="mb-12 text-center text-4xl font-medium tracking-tighter md:text-left md:text-5xl">
        upcoming_classes
      </h2>

      <div className="group relative w-full border border-neutral-800 bg-neutral-900/20 transition-all duration-300 hover:border-neutral-700">
        <div className="grid grid-cols-1 items-stretch gap-0 md:grid-cols-12 md:gap-8">
          <div className="relative flex h-64 w-full items-center justify-center overflow-hidden border-neutral-800 border-b bg-neutral-900 md:col-span-5 md:h-auto md:border-r md:border-b-0">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-neutral-700 to-black opacity-20" />
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-neutral-800 opacity-50 transition-transform duration-500 group-hover:scale-110">
              <div className="h-16 w-16 rounded-full border border-neutral-700" />
            </div>
          </div>

          <div className="flex flex-col items-start justify-center p-8 md:col-span-7 md:p-12">
            <div className="mb-6 flex items-center gap-3">
              <span className="rounded-sm border border-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-500">
                ex.01
              </span>
              <div className="h-px w-8 bg-neutral-800" />
            </div>

            <h3 className="mb-4 text-3xl font-medium tracking-tight text-white transition-colors group-hover:text-neutral-200 md:text-4xl">
              soft_landing
            </h3>

            <p className="mb-8 max-w-md text-lg leading-relaxed font-light text-neutral-400">
              learn how to build a landing page with ai in less than 2 hours.
            </p>

            <button
              type="button"
              className="flex items-center gap-2 border border-white/20 px-8 py-4 text-sm font-medium tracking-widest uppercase transition-all duration-300 hover:bg-white hover:text-black"
            >
              <span>Sign Up</span>
              <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
