/**
 * Hero product preview: the real PalmOS operator console (live screenshot)
 * presented in a clean window bezel with a lime depth glow behind it.
 */
export default function ConsolePreview() {
  return (
    <div className="relative mx-auto w-full max-w-[1240px] animate-fade-in">
      {/* depth glow */}
      <div className="pointer-events-none absolute -inset-x-10 -top-10 bottom-0 z-0 bg-lime/10 blur-[120px]" />

      <div className="group/window relative z-10 border border-white/10 bg-panel p-2 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.7)]">
        <div className="pointer-events-none absolute inset-x-8 top-0 z-20 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-80" />
        <img
          src="/dashboard-preview.png"
          alt="PalmOS operator console — assets under control, active wallets, pending approvals, and the on-chain decision log"
          width={2000}
          height={1299}
          loading="eager"
          className="block w-full border border-white/10"
        />
        {/* subtle bottom fade so the frame melts into the page */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-24 bg-gradient-to-t from-panel/60 to-transparent" />
      </div>
    </div>
  )
}
