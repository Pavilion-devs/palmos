import { useEffect, useState } from 'react'

function readHash() {
  return (window.location.hash || '').replace(/^#/, '')
}

export function navigate(target) {
  const next = target.startsWith('#') ? target : `#${target}`
  if (window.location.hash !== next) {
    window.location.hash = next
  }
}

export default function useHashRoute() {
  const [hash, setHash] = useState(() => readHash())

  useEffect(() => {
    function onChange() {
      setHash(readHash())
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return hash
}

export function parseDashboardRoute(hash) {
  const path = (hash || '').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!path || path === 'dashboard') {
    return { page: 'home' }
  }

  const segments = path.split('/')
  if (segments[0] !== 'dashboard') {
    return { page: 'home' }
  }

  const [, section, id] = segments

  if (section === 'onboarding') return { page: 'onboarding' }
  if (section === 'agents') {
    return id ? { page: 'agent-detail', agentId: id } : { page: 'agents' }
  }
  if (section === 'services') {
    return id ? { page: 'service-detail', serviceId: id } : { page: 'services' }
  }
  if (section === 'transactions') {
    return id ? { page: 'transaction-detail', executionId: id } : { page: 'transactions' }
  }
  if (section === 'approvals') return { page: 'approvals' }
  if (section === 'settings') return { page: 'settings' }

  return { page: 'home' }
}
