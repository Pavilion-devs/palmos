/**
 * Bordered section wrapper with the four signature corner dots.
 * Ported from the template's SectionFrame.
 */
export default function SectionFrame({ children, id, className = '' }) {
  return (
    <section
      id={id}
      className={`relative w-full border-b border-white/10 ${className}`}
    >
      {children}
      <div className="pointer-events-none absolute -top-[2px] -left-[2px] z-10 h-[3px] w-[3px] rounded-full bg-white/20" />
      <div className="pointer-events-none absolute -top-[2px] -right-[2px] z-10 h-[3px] w-[3px] rounded-full bg-white/20" />
      <div className="pointer-events-none absolute -bottom-[2px] -left-[2px] z-10 h-[3px] w-[3px] rounded-full bg-white/20" />
      <div className="pointer-events-none absolute -bottom-[2px] -right-[2px] z-10 h-[3px] w-[3px] rounded-full bg-white/20" />
    </section>
  )
}
