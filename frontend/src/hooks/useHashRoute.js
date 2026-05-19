import { useEffect, useState } from 'react'

const ROUTE_EVENT = 'palmos:route-change'

function readHash() {
  return (window.location.hash || '').replace(/^#/, '')
}

export function navigate(target) {
  const next = target.startsWith('#') ? target : `#${target}`
  if (window.location.hash !== next) {
    window.location.hash = next
  }
  window.dispatchEvent(new Event(ROUTE_EVENT))
}

export default function useHashRoute() {
  const [route, setRoute] = useState(() => ({
    hash: readHash(),
    version: 0,
  }))

  useEffect(() => {
    function onChange() {
      setRoute((previous) => ({
        hash: readHash(),
        version: previous.version + 1,
      }))
    }
    window.addEventListener('hashchange', onChange)
    window.addEventListener(ROUTE_EVENT, onChange)
    return () => {
      window.removeEventListener('hashchange', onChange)
      window.removeEventListener(ROUTE_EVENT, onChange)
    }
  }, [])

  return route.hash
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

  const [, section, id, subSection] = segments

  if (section === 'onboarding') return { page: 'onboarding' }
  if (section === 'agents') {
    if (id && subSection === 'credentials') {
      return { page: 'agent-credentials', agentId: id }
    }
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
