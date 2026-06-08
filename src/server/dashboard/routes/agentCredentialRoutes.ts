import type express from 'express'
import type { DashboardRouteContext } from '../context.js'
import { registerAgentCredentialLifecycleRoutes } from './agentCredentialLifecycleRoutes.js'
import { registerAgentCredentialManagementRoutes } from './agentCredentialManagementRoutes.js'

export function registerAgentCredentialRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  registerAgentCredentialManagementRoutes(app, context)
  registerAgentCredentialLifecycleRoutes(app, context)
}