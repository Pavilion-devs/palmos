import { signOperatorSession } from '../../src/server/dashboard/access.js'
import type { DashboardOperatorRole } from '../../src/store/DashboardOperatorRegistry.js'

// Test helper for the SIWS operator session cookie (replaces the retired
// palmos_operator_access / palmos_judge_access passcode cookies). Mints a signed
// palmos_operator_session cookie the same way the /api/auth/verify route does.
export const TEST_SESSION_SECRET = 'test-session-secret'

export function operatorSessionToken(input?: {
  operatorId?: string
  workspaceId?: string
  role?: DashboardOperatorRole
  expiresAt?: number
  secret?: string
}): string {
  return signOperatorSession(
    {
      operatorId: input?.operatorId ?? 'operator_primary',
      workspaceId: input?.workspaceId ?? 'palmos_workspace_default',
      role: input?.role ?? 'operator',
      expiresAt: input?.expiresAt ?? Date.now() + 60_000,
    },
    input?.secret ?? TEST_SESSION_SECRET,
  )
}

export function operatorSessionCookie(
  input?: Parameters<typeof operatorSessionToken>[0],
): string {
  return `palmos_operator_session=${encodeURIComponent(operatorSessionToken(input))}`
}
