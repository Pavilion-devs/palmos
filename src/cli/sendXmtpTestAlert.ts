import { join } from 'path'
import {
  FileXMTPAlertRegistry,
  XmtpNotifier,
  type AgentRecord,
  type PaidCallRecord,
} from '../index.js'

function readProcessEnv(): Record<string, string | undefined> {
  const scope = globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }

  return scope.process?.env ?? {}
}

const env = readProcessEnv()
const baseDir =
  env.AGENT_SPEND_OS_BASE_DIR?.trim() ||
  `/tmp/palmos-xmtp-test-${Date.now().toString(36)}`
const registry = new FileXMTPAlertRegistry(baseDir)
const notifier = XmtpNotifier.fromEnv(
  {
    ...env,
    XMTP_DB_PATH: env.XMTP_DB_PATH?.trim() || join(baseDir, 'xmtp-local.db3'),
  },
  registry,
)

if (!notifier) {
  throw new Error('XMTP_WALLET_KEY is required for xmtp:test.')
}

const now = new Date().toISOString()
const agent = {
  agentId: 'xmtp_test_agent',
  displayName: 'XMTP Test Agent',
  walletId: 'wallet_xmtp_test',
  status: 'approval_pending',
} as AgentRecord

const execution = {
  executionId: 'paid_call_xmtp_test',
  runId: 'run_xmtp_test',
  serviceId: 'local.pusd.spot_price',
  vendorId: 'local_pusd_demo',
  amount: '0.01',
  assetSymbol: 'PUSD',
  chainId: 'solana-mainnet',
  status: 'approval_pending',
  createdAt: now,
  updatedAt: now,
  agentId: agent.agentId,
  paymentRail: 'palmos-pusd',
  requestPayload: {
    base: 'BTC',
    quote: 'USD',
  },
  requestSummary: {
    base: 'BTC',
    quote: 'USD',
  },
} as PaidCallRecord

const result = await notifier.sendApprovalRequested({
  agent,
  execution,
})

console.log(
  JSON.stringify(
    {
      ok: result.status === 'sent',
      baseDir,
      alert: result,
      alertPath: join(baseDir, 'xmtp-alerts', `${result.alertId}.json`),
    },
    null,
    2,
  ),
)
