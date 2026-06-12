import type express from 'express'
import { createAgentFromOnboarding } from '../../../index.js'
import { readPusdNetworkFromEnv } from '../../../integrations/pusd/constants.js'
import {
  createOnboardingTurn,
  readOnboardingField,
  readOnboardingState,
} from '../../onboardingEngine.js'
import { requireDashboardRole } from '../access.js'
import { recordDashboardAudit } from '../audit.js'
import type { DashboardRouteContext } from '../context.js'
import { sanitizeCredential, stripAgentSecrets } from '../sanitizers.js'
import { readMaybeString, readOnboardingSetup } from '../shared.js'

export function registerAgentOnboardingRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.post('/api/dashboard/onboarding/turn', async (req, res) => {
    try {
      const turn = await createOnboardingTurn(context.env, {
        field: readMaybeString(req.body?.field),
        userReply: readMaybeString(req.body?.userReply) ?? '',
        state: req.body?.state,
      })

      res.json(turn)
    } catch (error) {
      res.status(500).json({
        ok: false,
        complete: false,
        state: readOnboardingState(req.body?.state),
        field: readOnboardingField(req.body?.field),
        inputType: 'text',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to continue PalmOS onboarding.',
      })
    }
  })

  app.get('/api/dashboard/agents', async (_req, res) => {
    const snapshot = await context.buildDashboardSnapshot()
    res.json({
      ok: true,
      agents: snapshot.agents,
      summary: snapshot.summary,
    })
  })

  app.post('/api/dashboard/agents', async (req, res) => {
    const identity = requireDashboardRole({
      req,
      res,
      context,
      operation: 'agent.create',
    })
    if (!identity) {
      return
    }

    try {
      const setup = readOnboardingSetup(req.body?.setup ?? req.body)
      if (!setup) {
        res.status(400).json({
          ok: false,
          error: 'Missing agent setup payload.',
        })
        return
      }

      const servicePayToAddress =
        context.localServer?.payToAddress ??
        context.env.PUSD_MERCHANT_WALLET?.trim()
      if (!servicePayToAddress) {
        res.status(400).json({
          ok: false,
          error:
            'No default service recipient wallet is configured. Start the local PUSD server or set PUSD_MERCHANT_WALLET.',
        })
        return
      }

      // Both wallet choices provision a real OWS Solana wallet. "create-new"
      // mints a fresh keypair (no import); "connect-existing" (walletMode
      // 'ows-import') links the operator's configured OWS_WALLET_PRIVATE_KEY.
      const wantsImport = setup.walletMode === 'ows-import'

      const created = await createAgentFromOnboarding(
        {
          workspace: context.workspace,
          credentials: context.workspace.agentCredentialRegistry,
          serviceCatalog: await context.buildPalmosServiceCatalog(),
          registeredServices: await context.workspace.serviceRegistry.list(),
        },
        {
          ...setup,
          walletMode: 'ows',
          solanaNetwork: readPusdNetworkFromEnv(context.env),
          organizationId:
            context.env.PALMOS_ORG_ID?.trim() || 'palmos_workspace_default',
          treasuryId:
            context.env.PALMOS_TREASURY_ID?.trim() || 'palmos_treasury_default',
          owsImportPrivateKey: wantsImport
            ? context.env.OWS_WALLET_PRIVATE_KEY?.trim()
            : undefined,
          servicePayToAddress,
        },
      )
      const snapshot = await context.buildDashboardSnapshot()
      await recordDashboardAudit({
        context,
        identity,
        action: 'agent.create',
        target: {
          type: 'agent',
          id: created.agent.agentId,
        },
        summary: `Created agent ${created.agent.agentId}.`,
        metadata: {
          settlementMode: created.agent.settlementMode,
          walletType: created.agent.walletType,
        },
      })

      res.json({
        ok: true,
        agent: stripAgentSecrets(created.agent),
        credential: sanitizeCredential(created.credential),
        token: created.token,
        snapshot,
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to create PalmOS agent.',
      })
    }
  })
}
