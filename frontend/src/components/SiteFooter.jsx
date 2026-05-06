export default function SiteFooter() {
  return (
    <section className="relative w-full overflow-hidden border-neutral-900 border-t bg-[#F5F2EB] px-6 pt-16 pb-0 text-black md:px-12">
      <div className="mb-16 grid grid-cols-1 gap-8 font-sans text-xs font-semibold tracking-tight uppercase md:mb-24 md:grid-cols-3 md:gap-4 md:text-sm">
        <div className="flex flex-col space-y-0.5">
          <a
            href="#"
            className="transition-colors hover:text-neutral-600"
            target="_blank"
            rel="noopener noreferrer"
          >
            PalmOS by Pavilion Devs
          </a>
          <p>Hackathon 2026</p>
          <p>Palm USD x Solana builders</p>
        </div>

        <div className="flex flex-col md:items-center">
          <a href="#" className="transition-colors hover:text-neutral-600">
            Twitter
          </a>
        </div>

        <div className="flex flex-col space-y-0.5 text-left md:items-end md:text-right">
          <p>PalmOS</p>
          <p>©2026 - Hackathon Entry</p>
        </div>
      </div>

      <div className="relative flex w-full flex-col items-center leading-none select-none pb-4 md:pb-8">
        <div className="w-full text-center">
          <h2 className="font-anton block w-full origin-bottom scale-y-[1.4] text-[25vw] leading-[0.8] tracking-[-0.03em] uppercase transform">
            PALM
          </h2>
        </div>
        <div className="-mt-[3vw] w-full text-center md:-mt-[2vw]">
          <h2 className="font-anton block w-full origin-top scale-y-[1.4] text-[25vw] leading-[0.8] tracking-[-0.03em] uppercase transform">
            OS
          </h2>
        </div>

        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <p className="font-marker rotate-[-6deg] text-center text-5xl leading-tight text-[#FACC15] opacity-90 mix-blend-multiply drop-shadow-sm md:text-7xl lg:text-9xl">
            wallets not blank checks
          </p>
        </div>
      </div>
    </section>
  )
}
