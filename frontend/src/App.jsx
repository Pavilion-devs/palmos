import { useState } from 'react'
import AboutSection from './components/AboutSection'
import CrewSection from './components/CrewSection'
import Hero from './components/Hero'
import JudgeAccessPage from './components/JudgeAccessPage'
import Navbar from './components/Navbar'
import Newsletter from './components/Newsletter'
import ProcessSection from './components/ProcessSection'
import SectionDivider from './components/SectionDivider'
import SiteFooter from './components/SiteFooter'
import Testimonials from './components/Testimonials'
import WaitlistModal from './components/WaitlistModal'
import Dashboard from './components/dashboard/Dashboard'
import useHashRoute from './hooks/useHashRoute'

const PUBLIC_ACCESS_MODE =
  import.meta.env.VITE_PALMOS_PUBLIC_ACCESS_MODE === '1' ||
  import.meta.env.PROD

function isJudgeSessionActive() {
  if (!PUBLIC_ACCESS_MODE) return true
  const expiresAt = Number(window.sessionStorage.getItem('palmos_judge_access'))
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

function LandingPage() {
  const [waitlistOpen, setWaitlistOpen] = useState(false)

  return (
    <div className="antialiased selection:bg-white selection:text-black">
      <Navbar onJoinWaitlist={() => setWaitlistOpen(true)} />
      <main className="relative w-full overflow-hidden pt-32">
        <Hero onGetStarted={() => setWaitlistOpen(true)} />
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
      <WaitlistModal
        open={waitlistOpen}
        onClose={() => setWaitlistOpen(false)}
      />
    </div>
  )
}

export default function App() {
  const hash = useHashRoute()

  if (hash === 'judge-access' || hash === 'demo-access') {
    return <JudgeAccessPage />
  }

  if (hash.startsWith('dashboard')) {
    if (!isJudgeSessionActive()) {
      return <JudgeAccessPage />
    }

    return <Dashboard />
  }

  return <LandingPage />
}
