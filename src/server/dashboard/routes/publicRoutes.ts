import type express from 'express'
import type { DashboardRouteContext } from '../context.js'
import {
  readWaitlistSubmission,
  saveWaitlistSubmission,
} from '../waitlist.js'

export function registerPublicRoutes(
  app: express.Express,
  context: DashboardRouteContext,
): void {
  app.post('/api/waitlist', async (req, res) => {
    try {
      const input = readWaitlistSubmission(req.body)
      if (!input) {
        res.status(400).json({
          ok: false,
          error: 'invalid_waitlist_submission',
        })
        return
      }

      await saveWaitlistSubmission(context.baseDir, input)

      res.json({
        ok: true,
        message: "You're on the PalmOS waitlist.",
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to join the PalmOS waitlist.',
      })
    }
  })
}

