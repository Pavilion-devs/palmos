import { useState } from 'react'
import { fetchDashboardApi } from '../useDashboardStore'

async function patchJson(url, body) {
  const response = await fetchDashboardApi(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || 'Update failed.')
  }
  return payload
}

// Updates an agent's governed rails. The limits go through the governed
// wallet.policy_update action (PATCH /policy); privacy is its own governed
// action (PATCH /privacy). Both are only sent when something actually changed.
export function useAgentPolicyUpdate() {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(agentId, { policyPatch, privacyMode }) {
    if (!agentId) return false
    setSaving(true)
    setError('')
    try {
      if (policyPatch && Object.keys(policyPatch).length > 0) {
        await patchJson(
          `/api/dashboard/agents/${encodeURIComponent(agentId)}/policy`,
          policyPatch,
        )
      }
      if (privacyMode != null) {
        await patchJson(
          `/api/dashboard/agents/${encodeURIComponent(agentId)}/privacy`,
          { privacyMode },
        )
      }
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.')
      return false
    } finally {
      setSaving(false)
    }
  }

  return { save, saving, error }
}
