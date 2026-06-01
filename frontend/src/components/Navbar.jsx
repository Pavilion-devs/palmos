import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { navLinks } from '../content'

export default function Navbar({ waitlistUrl }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      className={`fixed top-0 z-50 w-full transition-colors duration-300 ${
        scrolled
          ? 'border-b border-line bg-card/80 backdrop-blur-md'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="flex items-center justify-between px-6 py-5 md:px-12 md:py-6">
        <a href="#top" className="flex items-center gap-2">
          <img
            src={scrolled ? '/mark-ink.svg' : '/vite.svg'}
            alt=""
            aria-hidden="true"
            className="h-6 w-6"
          />
          <span
            className={`text-xl font-bold tracking-tight transition-colors ${
              scrolled ? 'text-ink' : 'text-white'
            }`}
          >
            PalmOS
          </span>
        </a>

        <div className="hidden gap-8 text-sm font-semibold md:flex">
          {navLinks.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              className={`transition-colors duration-300 ${
                scrolled
                  ? 'text-ink hover:text-forest'
                  : 'text-white hover:text-green-light'
              }`}
            >
              {label}
            </a>
          ))}
        </div>

        <a
          href={waitlistUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`group flex cursor-pointer items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold tracking-wide transition-colors duration-300 ${
            scrolled
              ? 'bg-forest text-white hover:bg-green-2'
              : 'bg-white text-ink hover:bg-green-pale'
          }`}
        >
          <span>Join waitlist</span>
          <ArrowUpRight
            className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            strokeWidth={2}
          />
        </a>
      </div>
    </nav>
  )
}
