import { useEffect } from 'react'

/**
 * Mount-once scroll-reveal driver. Replaces the template's GSAP ScrollTrigger
 * manager with a lightweight IntersectionObserver: every `.scroll-fade-in`
 * element gets `.is-revealed` toggled as it enters / leaves the viewport, which
 * drives the CSS blur-up transition in index.css. No GSAP dependency.
 */
export default function RevealManager() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const els = Array.from(document.querySelectorAll('.scroll-fade-in'))

    if (reduce || typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('is-revealed'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle('is-revealed', entry.isIntersecting)
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )

    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return null
}
