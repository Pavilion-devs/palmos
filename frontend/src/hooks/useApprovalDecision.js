import { useCallback, useState } from 'react'
import { fetchDashboardApi } from '../useDashboardStore'

// Approve/reject a pending action. POSTs /api/dashboard/approvals/:id/:decision
// (decision = 'approve' | 'reject'), then calls onResolved() to refresh the queue.
// Tracks a single in-flight decision so the UI can disable the row's buttons.
export function useApprovalDecision(onResolved) {
  const [pendingKey, setPendingKey] = useState(null)
  const [error, setError] = useState('')

  const decide = useCallback(
    async (executionId, decision) => {
      if (!executionId) return
      setPendingKey(`${executionId}:${decision}`)
      setError('')
      try {
        const response = await fetchDashboardApi(
          `/api/dashboard/approvals/${encodeURIComponent(executionId)}/${decision}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': crypto.randomUUID(),
            },
            body: '{}',
          },
        )
        const payload = await response.json().catch(() => null)
        if (!response.ok || payload?.ok === false) {
          throw new Error(
            payload?.message || payload?.error || 'Could not record the decision.',
          )
        }
        await onResolved?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not record the decision.')
      } finally {
        setPendingKey(null)
      }
    },
    [onResolved],
  )

  return { decide, pendingKey, error }
}
