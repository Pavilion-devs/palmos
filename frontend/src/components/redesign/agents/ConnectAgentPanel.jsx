import { useState } from 'react'
import {
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  Terminal,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAgents } from '../../../hooks/useAgents'
import { fetchDashboardApi } from '../../../useDashboardStore'

// Default policy/setup for a freshly connected agent. The operator only names the
// agent + picks a wallet option here; everything else uses sensible defaults.
// The wallet choice drives provisioning: "create-new" mints a fresh OWS Solana
// wallet; "connect-existing" links the operator's configured wallet. Both yield a
// real, fundable Solana address (no demo/placeholder addresses).
function buildAgentSetup(name, walletChoice) {
  return {
    agentName: name,
    agentTask: 'Operate wallets and paid services through PalmOS',
    maxPerCall: '2.00',
    sessionBudget: '2.00',
    autoApproveUnder: '0.05',
    allowedVendors: [
      'palmos.intel.onchain_flow',
      'palmos.research.defi_risk',
      'palmos.ops.vendor_brief',
    ],
    managerAddress: '',
    walletMode: walletChoice === 'connect-existing' ? 'ows-import' : 'ows',
  }
}

const WALLET_OPTIONS = [
  {
    id: 'create-new',
    icon: Plus,
    title: 'Create new wallet',
    body: 'PalmOS provisions a fresh governed wallet for this agent.',
  },
  {
    id: 'connect-existing',
    icon: Link2,
    title: 'Connect existing',
    body: 'Link a wallet you already control. The agent operates it under policy.',
  },
]

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // Clipboard may be blocked; the value is still visible to copy manually.
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      aria-label={`Copy ${label}`}
    >
      {copied ? (
        <Check className="size-3.5 text-lime" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// Agent-first onboarding hero: name the agent, choose a wallet option, then reveal
// the @getpalmos/agent connect command + a one-time scoped token. Used both as the
// 0-agents empty state and behind the in-app "Connect agent" action.
export function ConnectAgentPanel({ onConnected }) {
  const navigate = useNavigate()
  const [walletChoice, setWalletChoice] = useState('create-new')
  const [agentName, setAgentName] = useState('')
  const [step, setStep] = useState('choose') // 'choose' | 'creating' | 'reveal'
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null) // { agentId, name, token }

  // Live roster poll for the "waiting for your agent…" indicator (only in reveal).
  // Roster entries are shaped { agent, portfolio, ... }; "online" means the agent
  // has actually authenticated via the SDK (firstConnectedAt set), NOT merely that
  // the record exists (it exists from creation).
  const { agents } = useAgents({ poll: step === 'reveal' })
  const connectedAgent = created
    ? agents.find((entry) => entry?.agent?.agentId === created.agentId)
    : undefined
  const agentOnline = Boolean(connectedAgent?.agent?.firstConnectedAt)

  async function handleCreate(event) {
    event.preventDefault()
    const name = agentName.trim()
    if (!name) {
      setError('Give your agent a name.')
      return
    }

    setStep('creating')
    setError('')
    try {
      const response = await fetchDashboardApi('/api/dashboard/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup: buildAgentSetup(name, walletChoice) }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.ok || !payload?.agent?.agentId) {
        throw new Error(
          payload?.error || payload?.message || 'Could not connect the agent.',
        )
      }
      setCreated({
        agentId: payload.agent.agentId,
        name,
        token: payload.token,
        // Present only for a freshly-created (non-imported) wallet — shown once, for backup.
        recoveryPhrase: payload.walletBackup?.recoveryPhrase,
      })
      setStep('reveal')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect the agent.')
      setStep('choose')
    }
  }

  if (step === 'reveal' && created) {
    const command = `npm install @getpalmos/agent\nexport PALMOS_AGENT_TOKEN=${created.token}`
    return (
      <div className="mx-auto w-full max-w-2xl rounded-[var(--radius)] border border-hairline bg-panel p-7">
        {agentOnline ? (
          <div className="flex items-center gap-2 text-sm font-medium text-lime">
            <Check className="size-4" aria-hidden="true" />
            Agent “{created.name}” connected
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <KeyRound className="size-4" aria-hidden="true" />
            Agent “{created.name}” created
          </div>
        )}
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-foreground">
          Bring it online
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          Run this in your agent’s environment. The token is shown{' '}
          <span className="text-foreground">once</span> — copy it now.
        </p>

        <div className="mt-5 overflow-hidden rounded-[var(--radius-sm)] border border-hairline bg-background">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Terminal className="size-3.5" aria-hidden="true" />
              terminal
            </span>
            <CopyButton value={command} label="connect command" />
          </div>
          <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-6 text-foreground">
            <span className="text-muted-foreground">$ </span>npm install @getpalmos/agent{'\n'}
            <span className="text-muted-foreground">$ </span>export PALMOS_AGENT_TOKEN=
            <span className="break-all text-lime">{created.token}</span>
          </pre>
        </div>

        {created.recoveryPhrase && (
          <div className="mt-5 overflow-hidden rounded-[var(--radius-sm)] border border-pending/40 bg-pending/5">
            <div className="flex items-center justify-between border-b border-pending/30 px-4 py-2">
              <span className="inline-flex items-center gap-2 text-xs font-medium text-pending">
                <KeyRound className="size-3.5" aria-hidden="true" />
                Wallet recovery phrase — save it now
              </span>
              <CopyButton value={created.recoveryPhrase} label="recovery phrase" />
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-6 text-foreground">
              {created.recoveryPhrase}
            </pre>
            <p className="px-4 pb-3 text-xs leading-5 text-muted-foreground">
              Shown <span className="text-foreground">once</span> — this is the only way to recover this
              wallet. PalmOS can’t show it again. Store it somewhere safe and offline.
            </p>
          </div>
        )}

        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-panel-2 px-3 py-1.5 text-xs text-muted-foreground">
          {agentOnline ? (
            <>
              <span className="size-2 rounded-full bg-lime" />
              Agent connected — it’s online and operating under policy.
            </>
          ) : (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Waiting for your agent to connect…
            </>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setCreated(null)
              setAgentName('')
              setStep('choose')
            }}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Connect another
          </button>
          <button
            type="button"
            onClick={() => {
              onConnected?.()
              navigate('/dashboard')
            }}
            className="group inline-flex items-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
          >
            Go to dashboard
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl rounded-[var(--radius)] border border-hairline bg-panel p-7">
      <div className="mb-6 flex size-11 items-center justify-center rounded-2xl bg-lime/15 ring-1 ring-lime/30">
        <KeyRound className="size-5 text-lime" strokeWidth={2} aria-hidden="true" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Connect your first agent
      </h2>
      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
        PalmOS is a control layer for AI-agent wallets. Connect an agent running
        the <span className="font-mono text-foreground">@getpalmos/agent</span> SDK
        — it operates under your policies and approvals.
      </p>

      {error && (
        <div className="mt-5 rounded-[var(--radius-sm)] border border-blocked/30 bg-blocked/10 px-3 py-2 text-sm text-blocked">
          {error}
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-6 space-y-6">
        <div>
          <label
            htmlFor="agent-name"
            className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            Agent name
          </label>
          <input
            id="agent-name"
            value={agentName}
            onChange={(event) => {
              setAgentName(event.target.value)
              setError('')
            }}
            placeholder="Treasury Ops Agent"
            className="mt-2 w-full rounded-[var(--radius-sm)] border border-hairline bg-background px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-lime/50"
          />
        </div>

        <fieldset>
          <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Agent wallet
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {WALLET_OPTIONS.map((option) => {
              const Icon = option.icon
              const selected = walletChoice === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setWalletChoice(option.id)}
                  aria-pressed={selected}
                  className={`rounded-[var(--radius-sm)] border p-4 text-left transition-colors ${
                    selected
                      ? 'border-lime/60 bg-lime/[0.06]'
                      : 'border-hairline bg-panel-2 hover:border-lime/30'
                  }`}
                >
                  <Icon
                    className={`size-5 ${selected ? 'text-lime' : 'text-muted-foreground'}`}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <div className="mt-2 text-sm font-medium text-foreground">
                    {option.title}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    {option.body}
                  </div>
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Wallet provisioning options finalize during setup — your agent connects
            now.
          </p>
        </fieldset>

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={step === 'creating'}
            className="group inline-flex items-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60"
          >
            {step === 'creating' ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Connecting…
              </>
            ) : (
              <>
                Connect agent
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
