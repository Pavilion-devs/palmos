import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { navigate } from '../../../hooks/useHashRoute'

const STATUS_TONE = {
  active: 'text-green-400',
  pending: 'text-yellow-400',
  blocked: 'text-red-400',
  revoked: 'text-red-400',
  denied: 'text-red-400',
  idle: 'text-neutral-500',
}

function formatPusd(value, digits = 3) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '0.000'
}

function AgentRow({ agent }) {
  const statusTone = STATUS_TONE[agent.status] ?? STATUS_TONE.idle
  const budgetPercent = agent.budgetTotal
    ? Math.min(100, (agent.budgetUsed / agent.budgetTotal) * 100)
    : 0

  return (
    <button
      type="button"
      onClick={() => navigate(`#dashboard/agents/${agent.id}`)}
      className="flex w-full flex-col gap-4 border border-neutral-800 bg-neutral-950 p-5 text-left transition-colors hover:border-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full bg-current ${statusTone}`} />
            <span className={`text-[10px] uppercase tracking-widest ${statusTone}`}>
              {agent.status}
            </span>
          </div>
          <h3 className="line-clamp-2 text-base font-medium text-white">{agent.name}</h3>
          <p className="mt-1 truncate font-mono text-[11px] text-neutral-600">{agent.id}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-neutral-700 bg-neutral-900 font-mono text-sm text-neutral-300">
          {agent.letter}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-neutral-600">
            Session
          </span>
          <span className="font-mono text-xs text-neutral-400">
            {formatPusd(agent.budgetUsed)} / {formatPusd(agent.budgetTotal, 2)} PUSD
          </span>
        </div>
        <div className="h-1.5 bg-neutral-800">
          <div className="h-full bg-white" style={{ width: `${budgetPercent}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-neutral-900 pt-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-700">Max</div>
          <div className="mt-1 truncate font-mono text-xs text-neutral-400">
            {formatPusd(agent.policy?.maxPerCall, 2)} PUSD
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-700">Services</div>
          <div className="mt-1 truncate font-mono text-xs text-neutral-400">
            {agent.policy?.vendors?.length ?? 0}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-700">Wallet</div>
          <div className="mt-1 truncate font-mono text-[11px] text-neutral-400">
            {agent.policy?.walletBackend === 'ows' ? 'OWS' : 'Local'}
          </div>
        </div>
      </div>
    </button>
  )
}

const DEFAULT_AGENT_FORM = {
  agentName: '',
  agentTask: '',
  sessionBudget: '1.00',
  maxPerCall: '0.05',
  autoApproveUnder: '0.05',
  walletMode: 'local-demo',
}

function Field({ label, id, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="text-[10px] uppercase tracking-widest text-neutral-600">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && !error && <p className="mt-1 text-[11px] text-neutral-600">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-[11px] text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

function validateAgentForm(form) {
  const errors = {}
  if (!form.agentName.trim()) errors.agentName = 'Agent name is required.'
  if (!form.agentTask.trim()) errors.agentTask = 'Agent task is required.'

  const sessionBudget = Number(form.sessionBudget)
  const maxPerCall = Number(form.maxPerCall)
  const autoApproveUnder = Number(form.autoApproveUnder)

  if (!Number.isFinite(sessionBudget) || sessionBudget <= 0) {
    errors.sessionBudget = 'Enter a positive session budget.'
  }
  if (!Number.isFinite(maxPerCall) || maxPerCall <= 0) {
    errors.maxPerCall = 'Enter a positive max per call.'
  }
  if (!Number.isFinite(autoApproveUnder) || autoApproveUnder <= 0) {
    errors.autoApproveUnder = 'Enter a positive auto-approve threshold.'
  }
  if (
    Number.isFinite(sessionBudget) &&
    Number.isFinite(maxPerCall) &&
    sessionBudget < maxPerCall
  ) {
    errors.sessionBudget = 'Session budget must cover at least one max call.'
  }
  if (
    Number.isFinite(autoApproveUnder) &&
    Number.isFinite(maxPerCall) &&
    autoApproveUnder > maxPerCall
  ) {
    errors.autoApproveUnder = 'Auto-approve cannot exceed max per call.'
  }

  return errors
}

function NewAgentForm({ onCancel, createAgent }) {
  const [form, setForm] = useState(DEFAULT_AGENT_FORM)
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [pending, setPending] = useState(false)

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  async function submit(event) {
    event.preventDefault()
    const nextErrors = validateAgentForm(form)
    setErrors(nextErrors)
    setServerError('')
    if (Object.values(nextErrors).some(Boolean)) return

    setPending(true)
    try {
      const agent = await createAgent({
        ...form,
        allowedVendors: ['local.palmos.ops', 'local.palmos.spot_price'],
      })
      navigate(`#dashboard/agents/${agent.agentId}`)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unable to create agent.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-5 border border-neutral-800 bg-neutral-950 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-600">
            New agent
          </div>
          <h2 className="mt-1 text-base font-medium text-white">Create payment identity</h2>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-10 min-w-10 items-center justify-center text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          aria-label="Close new agent form"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {serverError && (
        <div className="mb-4 border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {serverError}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field id="agentName" label="Agent name" error={errors.agentName}>
          <input
            id="agentName"
            type="text"
            autoComplete="off"
            value={form.agentName}
            onChange={(event) => updateField('agentName', event.target.value)}
            aria-invalid={errors.agentName ? 'true' : undefined}
            aria-describedby={errors.agentName ? 'agentName-error' : undefined}
            className="min-h-10 w-full border border-neutral-800 bg-black px-3 text-sm text-white focus:border-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
            placeholder="Treasury Research Agent"
          />
        </Field>

        <Field id="walletMode" label="Wallet mode" hint="OWS is used when configured server-side.">
          <select
            id="walletMode"
            value={form.walletMode}
            onChange={(event) => updateField('walletMode', event.target.value)}
            className="min-h-10 w-full border border-neutral-800 bg-black px-3 text-sm text-white focus:border-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            <option value="local-demo">Local demo</option>
            <option value="ows">OWS wallet</option>
            <option value="real-solana">Runtime Solana</option>
          </select>
        </Field>

        <div className="md:col-span-2">
          <Field id="agentTask" label="Agent task" error={errors.agentTask}>
            <textarea
              id="agentTask"
              rows={3}
              value={form.agentTask}
              onChange={(event) => updateField('agentTask', event.target.value)}
              aria-invalid={errors.agentTask ? 'true' : undefined}
              aria-describedby={errors.agentTask ? 'agentTask-error' : undefined}
              className="w-full resize-none border border-neutral-800 bg-black px-3 py-2 text-sm leading-6 text-white focus:border-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
              placeholder="Pay approved market-data services and produce a daily ops brief."
            />
          </Field>
        </div>

        {[
          ['sessionBudget', 'Session budget', '1.00'],
          ['maxPerCall', 'Max per call', '0.05'],
          ['autoApproveUnder', 'Auto approve under', '0.05'],
        ].map(([field, label, placeholder]) => (
          <Field key={field} id={field} label={label} error={errors[field]}>
            <input
              id={field}
              type="text"
              inputMode="decimal"
              value={form[field]}
              onChange={(event) => updateField(field, event.target.value)}
              aria-invalid={errors[field] ? 'true' : undefined}
              aria-describedby={errors[field] ? `${field}-error` : undefined}
              className="min-h-10 w-full border border-neutral-800 bg-black px-3 font-mono text-sm text-white focus:border-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
              placeholder={placeholder}
            />
          </Field>
        ))}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-10 border border-neutral-800 px-4 text-xs uppercase tracking-widest text-neutral-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="min-h-10 border border-white bg-white px-4 text-xs uppercase tracking-widest text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? 'Creating...' : 'Create agent'}
        </button>
      </div>
    </form>
  )
}

export default function MyAgentsPage({
  agents,
  onCreateAgent,
  createAgent,
  createOpen = false,
  onCreateOpenChange,
}) {
  const [localCreateOpen, setLocalCreateOpen] = useState(false)
  const [view, setView] = useState('active')
  const showCreateForm = onCreateOpenChange ? createOpen : localCreateOpen
  const archivedAgents = agents.filter((agent) => agent.lifecycleStatus === 'archived')
  const activeAgents = agents.filter((agent) => agent.lifecycleStatus !== 'archived')
  const visibleAgents = view === 'archived' ? archivedAgents : activeAgents

  function setCreateOpen(value) {
    if (onCreateOpenChange) {
      onCreateOpenChange(value)
      return
    }
    setLocalCreateOpen(value)
  }

  function openCreateForm() {
    if (createAgent) {
      setCreateOpen(true)
      return
    }
    onCreateAgent()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-800 px-6 py-5">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-600">
            My agents
          </div>
          <h1 className="mt-1 text-xl font-medium text-white">
            {visibleAgents.length} {visibleAgents.length === 1 ? 'agent' : 'agents'} {view === 'archived' ? 'archived' : 'active'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-neutral-800 bg-black">
            {[
              ['active', `Active ${activeAgents.length}`],
              ['archived', `Archived ${archivedAgents.length}`],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`min-h-10 px-3 text-[10px] uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${
                  view === id
                    ? 'bg-white text-black'
                    : 'text-neutral-500 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={openCreateForm}
            className="flex min-h-10 items-center gap-2 border border-neutral-700 bg-neutral-900 px-4 text-xs uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New agent
          </button>
        </div>
      </div>

      <div className="px-6 py-5">
        {showCreateForm && createAgent && (
          <NewAgentForm
            createAgent={createAgent}
            onCancel={() => setCreateOpen(false)}
          />
        )}

        {visibleAgents.length === 0 ? (
          <div className="border border-dashed border-neutral-800 px-6 py-12 text-center">
            <p className="text-sm text-neutral-400">
              {view === 'archived' ? 'No archived agents.' : 'No active agents registered yet.'}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-widest text-neutral-700">
              {view === 'archived'
                ? 'Archived agents appear here after they are retired.'
                : 'Create your first agent to start using PalmOS.'}
            </p>
            {view !== 'archived' && (
              <button
                type="button"
                onClick={openCreateForm}
                className="mt-5 inline-flex min-h-10 items-center gap-2 border border-white px-4 text-xs uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Create first agent
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleAgents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
