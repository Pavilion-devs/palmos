import type express from 'express'
import type { DashboardRouteContext } from '../context.js'
import { sendDashboardApiError } from '../apiErrors.js'
import { SolanaPortfolioReader } from '../../../integrations/portfolio/solanaPortfolioReader.js'
import { CachedPortfolioReader } from '../../../integrations/portfolio/cachedPortfolioReader.js'
import { readMaybeString, readRecord } from '../shared.js'
import {
  currentNetwork,
  rpcHost,
  setNetworkOverride,
  type NetworkChoice,
} from '../networkOverride.js'

/**
 * Dashboard control for the active Solana cluster. The choice is persisted (see networkOverride)
 * and applied to process.env so settlement picks it up immediately; we also hot-swap the portfolio
 * reader so balances reflect the new cluster without a restart.
 */
export function registerNetworkRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.get('/api/dashboard/network', (_req, res) => {
    res.json({ ok: true, network: currentNetwork(process.env), rpcHost: rpcHost(process.env) })
  })

  app.post('/api/dashboard/network', (req, res) => {
    const body = readRecord(req.body)
    const network = readMaybeString(body.network)
    if (network !== 'mainnet' && network !== 'devnet') {
      sendDashboardApiError(res, 400, {
        code: 'invalid_request',
        message: "network must be 'mainnet' or 'devnet'.",
      })
      return
    }

    setNetworkOverride(context.baseDir, network as NetworkChoice)

    const reader = SolanaPortfolioReader.fromEnv(process.env)
    if (reader) {
      context.portfolioReader = new CachedPortfolioReader(reader, {})
    }

    res.json({ ok: true, network: currentNetwork(process.env), rpcHost: rpcHost(process.env) })
  })
}
