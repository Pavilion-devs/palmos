import type {
  DashboardAuditAction,
  DashboardAuditTarget,
} from '../../store/DashboardAuditLogRegistry.js'
import type { DashboardAccessIdentity } from './access.js'
import type { DashboardRouteContext } from './context.js'
import { createId } from './shared.js'

export async function recordDashboardAudit(input: {
  context: DashboardRouteContext
  identity: DashboardAccessIdentity
  action: DashboardAuditAction
  status?: 'succeeded' | 'failed'
  target?: DashboardAuditTarget
  summary: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const at = new Date().toISOString()
  await input.context.workspace.dashboardAuditLogRegistry.put({
    auditLogId: createId('dashboard_audit'),
    at,
    workspaceId: input.identity.workspaceId,
    actorId: input.identity.actorId,
    operatorId: input.identity.operatorId,
    operatorRole: input.identity.role,
    source: input.identity.source,
    action: input.action,
    status: input.status ?? 'succeeded',
    target: input.target,
    summary: input.summary,
    metadata: input.metadata,
  })
}
