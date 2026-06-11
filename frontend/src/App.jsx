import AboutSection from './components/AboutSection'
import AgentCapabilitiesSection from './components/AgentCapabilitiesSection'
import CrewSection from './components/CrewSection'
// import DocsPage from './components/DocsPage'
import Hero from './components/Hero'
import Navbar from './components/Navbar'
import Newsletter from './components/Newsletter'
import OperatorControlsSection from './components/OperatorControlsSection'
import ProcessSection from './components/ProcessSection'
import SectionDivider from './components/SectionDivider'
import SiteFooter from './components/SiteFooter'
import Testimonials from './components/Testimonials'
import WorkflowsSection from './components/WorkflowsSection'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import RedesignDashboard from './components/redesign/RedesignDashboard'

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
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        {/* The SIWS-gated operator dashboard. RedesignDashboard owns the nested
            /dashboard/* routes (Overview, Wallets, Activity, …, Connect). */}
        <Route path="/dashboard/*" element={<RedesignDashboard />} />
      </Routes>
    </BrowserRouter>
  )
}
