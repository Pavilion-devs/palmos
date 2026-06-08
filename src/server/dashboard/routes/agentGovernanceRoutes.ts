import type express from 'express'
import type { DashboardRouteContext } from '../context.js'
import { registerAgentLifecycleRoutes } from './agentLifecycleRoutes.js'
import { registerAgentPolicyRoutes } from './agentPolicyRoutes.js'

export function registerAgentGovernanceRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  registerAgentPolicyRoutes(app, context)
  registerAgentLifecycleRoutes(app, context)
}
