import AboutSection from './components/AboutSection'
import AgentCapabilitiesSection from './components/AgentCapabilitiesSection'
import CrewSection from './components/CrewSection'
// import DocsPage from './components/DocsPage'
import Hero from './components/Hero'
import JudgeAccessPage from './components/JudgeAccessPage'
import Navbar from './components/Navbar'
import Newsletter from './components/Newsletter'
import OperatorControlsSection from './components/OperatorControlsSection'
import ProcessSection from './components/ProcessSection'
import SectionDivider from './components/SectionDivider'
import SiteFooter from './components/SiteFooter'
import Testimonials from './components/Testimonials'
import WorkflowsSection from './components/WorkflowsSection'
import Dashboard from './components/dashboard/Dashboard'
import useHashRoute from './hooks/useHashRoute'

const WAITLIST_URL = 'https://tally.so/r/aQva1q'

/* --------------------------------------------------------------------------
 * LANDING MOTION STORYBOARD
 *
 * Static shell: navbar is visible immediately.
 *
 *    0ms   hero palm mark fades in + floats in place
 *   80ms   hero headline rises into focus
 *  200ms   hero eyebrow appears
 *  300ms   hero body copy appears
 *  420ms   hero CTA appears
 * scroll   each section fades, blurs out, and rises into place
 * scroll   repeated cards/steps/logos cascade by index
 * -------------------------------------------------------------------------- */

const PUBLIC_ACCESS_MODE =
  import.meta.env.VITE_PALMOS_PUBLIC_ACCESS_MODE === '1' ||
  import.meta.env.PROD

function isJudgeSessionActive() {
  if (!PUBLIC_ACCESS_MODE) return true
  const expiresAt = Number(
    window.sessionStorage.getItem('palmos_dashboard_access') ??
      window.sessionStorage.getItem('palmos_judge_access'),
  )
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

function LandingPage() {
  return (
    <div id="top" className="bg-page text-ink antialiased selection:bg-forest selection:text-white">
      <Navbar waitlistUrl={WAITLIST_URL} />
      <main className="relative w-full overflow-hidden">
        <Hero waitlistUrl={WAITLIST_URL} />
        <SectionDivider />
        <AboutSection />
        <SectionDivider />
        <AgentCapabilitiesSection />
        {/* <SectionDivider />
        <OperatorControlsSection />
        <SectionDivider />
        <WorkflowsSection /> */}
        <SectionDivider />
        <ProcessSection />
        <SectionDivider />
        <Testimonials />
        <CrewSection />
        <Newsletter waitlistUrl={WAITLIST_URL} />
        <SiteFooter />
      </main>
    </div>
  )
}

export default function App() {
  const hash = useHashRoute()

  if (hash === 'judge-access' || hash === 'demo-access') {
    return <JudgeAccessPage />
  }

  // if (hash === 'docs') {
  //   return <DocsPage />
  // }

  if (hash.startsWith('dashboard')) {
    if (!isJudgeSessionActive()) {
      return <JudgeAccessPage />
    }

    return <Dashboard />
  }

  return <LandingPage />
}
