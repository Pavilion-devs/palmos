import { useState, useEffect } from 'react'
import AboutSection from './components/AboutSection'
import CrewSection from './components/CrewSection'
import Hero from './components/Hero'
import Navbar from './components/Navbar'
import Newsletter from './components/Newsletter'
import ProcessSection from './components/ProcessSection'
import SectionDivider from './components/SectionDivider'
import SiteFooter from './components/SiteFooter'
import Testimonials from './components/Testimonials'
import Dashboard from './components/dashboard/Dashboard'

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return hash
}

function LandingPage() {
  return (
    <div className="antialiased selection:bg-white selection:text-black">
      <Navbar />
      <main className="relative w-full overflow-hidden pt-32">
        <Hero />
        <SectionDivider />
        <AboutSection />
        <SectionDivider />
        <ProcessSection />
        <SectionDivider />
        <Testimonials />
        <CrewSection />
        <Newsletter />
        <SiteFooter />
      </main>
    </div>
  )
}

export default function App() {
  const hash = useHashRoute()

  if (hash.startsWith('#dashboard')) {
    return <Dashboard />
  }

  return <LandingPage />
}
