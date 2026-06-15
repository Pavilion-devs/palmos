import { BrowserRouter, Route, Routes } from 'react-router-dom'
import RedesignDashboard from './components/redesign/RedesignDashboard'

import LandingNavbar from './components/landing/LandingNavbar'
import LandingHero from './components/landing/LandingHero'
import HowItWorks from './components/landing/HowItWorks'
import Capabilities from './components/landing/Capabilities'
import WhyPalmos from './components/landing/WhyPalmos'
import TrustStrip from './components/landing/TrustStrip'
import FinalCTA from './components/landing/FinalCTA'
import LandingFooter from './components/landing/LandingFooter'
import RevealManager from './components/landing/RevealManager'
import FlashlightLayer from './components/landing/FlashlightLayer'

/* --------------------------------------------------------------------------
 * LANDING — dark + lime, adapted from the editorial template to PalmOS.
 *
 * Page chrome (fixed decorative grid guides + sticky navbar + centered
 * max-width column) wraps the section stack. Scroll reveals and the hover
 * flashlight are driven by single mounted managers.
 * -------------------------------------------------------------------------- */

function LandingPage() {
  return (
    <div
      id="top"
      className="landing-dark relative flex min-h-screen w-full flex-col overflow-x-hidden bg-background font-sans text-white antialiased selection:bg-lime selection:text-black"
    >
      {/* Decorative vertical grid guides */}
      <div className="pointer-events-none fixed inset-0 z-0 mx-auto flex w-full max-w-[1360px] justify-center border-x border-white/5">
        <div className="absolute left-1/2 top-0 bottom-0 hidden w-px -translate-x-1/2 bg-white/[0.03] md:block" />
      </div>

      <LandingNavbar />

      <main className="relative z-10 mx-auto w-full max-w-[1360px] flex-1">
        <LandingHero />
        <HowItWorks />
        <Capabilities />
        <WhyPalmos />
        <TrustStrip />
        <FinalCTA />
        <LandingFooter />
      </main>

      <RevealManager />
      <FlashlightLayer />
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
