import type express from 'express'
import type { DashboardRouteContext } from '../context.js'
import { registerAgentCredentialRoutes } from './agentCredentialRoutes.js'
import { registerAgentGovernanceRoutes } from './agentGovernanceRoutes.js'
import { registerAgentOnboardingRoutes } from './agentOnboardingRoutes.js'
import { registerAgentRunRoutes } from './agentRunRoutes.js'
import { registerAgentWalletContextRoutes } from './agentWalletContextRoutes.js'
import { registerAgentWalletCycleRoutes } from './agentWalletCycleRoutes.js'

export function registerAgentRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  registerAgentOnboardingRoutes(app, context)
  registerAgentGovernanceRoutes(app, context)
  registerAgentCredentialRoutes(app, context)
  registerAgentRunRoutes(app, context)
  registerAgentWalletContextRoutes(app, context)
  registerAgentWalletCycleRoutes(app, context)
}
