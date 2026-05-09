import {
  Archive,
  ArrowLeft,
  ExternalLink,
  PauseCircle,
  Play,
  Save,
  ShieldCheck,
} from 'lucide-react'
import { useState } from 'react'
import { navigate } from '../../../hooks/useHashRoute'
import CredentialsManager from '../CredentialsManager'
import PusdReadinessPanel from '../PusdReadinessPanel'

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

function shortHash(value) {
  if (!value) return null
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

function Section({ title, action, children }) {
  return (
    <section className="border border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-900 px-5 py-3">
        <h2 className="text-[10px] uppercase tracking-widest text-neutral-500">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function DetailRow({ label, value, mono }) {
  return (
    <div className="border-b border-neutral-900 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="text-[10px] uppercase tracking-widest text-neutral-700">{label}</div>
      <div
        className={`mt-1 break-words text-sm text-neutral-300 ${
          mono ? 'font-mono text-xs' : ''
        }`}
      >
        {value ?? 'n/a'}
      </div>
    </div>
  )
}

function StatTile({ label, value, tone = 'neutral' }) {
  const toneClass =
    tone === 'green'
      ? 'text-green-400'
      : tone === 'yellow'
        ? 'text-yellow-400'
        : tone === 'red'
          ? 'text-red-400'
          : 'text-white'
  return (
    <div className="border border-neutral-800 bg-neutral-950 p-4">
      <div className="text-[10px] uppercase tracking-widest text-neutral-700">{label}</div>
      <div className={`mt-2 font-mono text-lg ${toneClass}`}>{value}</div>
    </div>
  )
}

function FormField({ id, label, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="text-[10px] uppercase tracking-widest text-neutral-700">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-[11px] text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

function validatePolicyForm(form) {
  const errors = {}
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
    errors.autoApproveUnder = 'Enter a positive threshold.'
  }
  if (
    Number.isFinite(sessionBudget) &&
    Number.isFinite(maxPerCall) &&
    sessionBudget < maxPerCall
  ) {
    errors.sessionBudget = 'Session budget must be at least max per call.'
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

function AgentPolicyEditor({ agent, updateAgentPolicy }) {
  const [form, setForm] = useState(() => ({
    sessionBudget: formatPusd(agent.policy?.sessionBudget, 2),
    maxPerCall: formatPusd(agent.policy?.maxPerCall, 2),
    autoApproveUnder: formatPusd(agent.policy?.autoApproveMax, 2),
  }))
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setSaved(false)
  }

  async function submit(event) {
    event.preventDefault()
    if (!updateAgentPolicy) return

    const nextErrors = validatePolicyForm(form)
    setErrors(nextErrors)
    setServerError('')
    setSaved(false)
    if (Object.values(nextErrors).some(Boolean)) return

    setPending(true)
    try {
      await updateAgentPolicy(agent.id, {
        sessionBudget: form.sessionBudget,
        maxPerCall: form.maxPerCall,
        autoApproveUnder: form.autoApproveUnder,
      })
      setSaved(true)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unable to save policy.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {serverError && (
        <div className="border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {serverError}
        </div>
      )}
      {saved && (
        <div className="border border-green-500/30 bg-green-500/5 px-3 py-2 text-sm text-green-300">
          Policy saved.
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {[
          ['sessionBudget', 'Session budget'],
          ['maxPerCall', 'Max per call'],
          ['autoApproveUnder', 'Auto approve under'],
        ].map(([field, label]) => (
          <FormField key={field} id={`policy-${field}`} label={label} error={errors[field]}>
            <input
              id={`policy-${field}`}
              type="text"
              inputMode="decimal"
              value={form[field]}
              onChange={(event) => updateField(field, event.target.value)}
              disabled={!updateAgentPolicy || agent.lifecycleStatus === 'archived'}
              aria-invalid={errors[field] ? 'true' : undefined}
              aria-describedby={errors[field] ? `policy-${field}-error` : undefined}
              className="min-h-10 w-full border border-neutral-800 bg-black px-3 font-mono text-sm text-white focus:border-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
            />
          </FormField>
        ))}
      </div>
      <button
        type="submit"
        disabled={pending || !updateAgentPolicy || agent.lifecycleStatus === 'archived'}
        aria-busy={pending}
        className="inline-flex min-h-10 items-center gap-2 border border-neutral-700 bg-neutral-900 px-4 text-xs uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Save className="h-3.5 w-3.5" aria-hidden="true" />
        {pending ? 'Saving...' : 'Save policy'}
      </button>
    </form>
  )
}

function AgentLifecycleControls({ agent, runAgentLifecycleAction }) {
  const [pendingAction, setPendingAction] = useState('')
  const [error, setError] = useState('')

  async function run(action) {
    if (!runAgentLifecycleAction) return
    setPendingAction(action)
    setError('')
    try {
      await runAgentLifecycleAction(agent.id, action)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update lifecycle.')
    } finally {
      setPendingAction('')
    }
  }

  const isArchived = agent.lifecycleStatus === 'archived'
  const isSuspended = agent.lifecycleStatus === 'suspended'

  return (
    <div className="space-y-3">
      {error && (
        <div className="border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => run('suspend')}
          disabled={!runAgentLifecycleAction || isSuspended || isArchived || Boolean(pendingAction)}
          className="inline-flex min-h-10 items-center justify-center gap-2 border border-neutral-800 bg-black px-3 text-xs uppercase tracking-widest text-neutral-300 transition-colors hover:text-yellow-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {pendingAction === 'suspend' ? 'Suspending...' : 'Suspend'}
        </button>
        <button
          type="button"
          onClick={() => run('reactivate')}
          disabled={!runAgentLifecycleAction || !isSuspended || isArchived || Boolean(pendingAction)}
          className="inline-flex min-h-10 items-center justify-center gap-2 border border-neutral-800 bg-black px-3 text-xs uppercase tracking-widest text-neutral-300 transition-colors hover:text-green-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {pendingAction === 'reactivate' ? 'Reactivating...' : 'Reactivate'}
        </button>
        <button
          type="button"
          onClick={() => run('archive')}
          disabled={!runAgentLifecycleAction || isArchived || Boolean(pendingAction)}
          className="inline-flex min-h-10 items-center justify-center gap-2 border border-red-500/30 bg-red-500/5 px-3 text-xs uppercase tracking-widest text-red-300 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
          {pendingAction === 'archive' ? 'Archiving...' : 'Archive'}
        </button>
      </div>
    </div>
  )
}

function AgentServicesManager({
  agent,
  services,
  allowServiceForAgent,
  unallowServiceForAgent,
}) {
  const [pendingServiceId, setPendingServiceId] = useState('')
  const [error, setError] = useState('')
  const allowedVendorIds = new Set(agent.policy?.allowedVendorIds ?? [])

  async function updateService(service, allowed) {
    setPendingServiceId(service.serviceId)
    setError('')
    try {
      if (allowed) {
        await allowServiceForAgent(agent.id, service.serviceId)
      } else {
        await unallowServiceForAgent(agent.id, service.serviceId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update service access.')
    } finally {
      setPendingServiceId('')
    }
  }

  if (!services.length) {
    return <p className="text-xs text-neutral-500">No services are registered yet.</p>
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      <ul className="space-y-2">
        {services.map((service) => {
          const isAllowed = allowedVendorIds.has(service.vendorId)
          const pending = pendingServiceId === service.serviceId
          return (
            <li
              key={service.serviceId}
              className="flex flex-col gap-3 border border-neutral-900 bg-black p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-neutral-300">{service.label}</div>
                <div className="mt-1 truncate font-mono text-[10px] text-neutral-600">
                  {service.vendorId} / {service.expectedAmount} PUSD
                </div>
              </div>
              <button
                type="button"
                onClick={() => updateService(service, !isAllowed)}
                disabled={
                  pending ||
                  !allowServiceForAgent ||
                  !unallowServiceForAgent ||
                  agent.lifecycleStatus === 'archived'
                }
                className={`min-h-10 border px-3 text-[10px] uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40 ${
                  isAllowed
                    ? 'border-green-500/20 bg-green-500/5 text-green-300 hover:bg-green-500/10'
                    : 'border-neutral-700 bg-neutral-900 text-white hover:bg-neutral-800'
                }`}
              >
                {pending ? 'Updating...' : isAllowed ? 'Unallow' : 'Allow'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NotFound({ agentId }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-neutral-600">
          Agent not found
        </div>
        <h2 className="text-lg font-medium text-white">No agent matches this id</h2>
        <p className="mt-3 break-all text-sm text-neutral-500">{agentId}</p>
        <button
          type="button"
          onClick={() => navigate('#dashboard/agents')}
          className="mt-5 inline-flex items-center gap-2 border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs uppercase tracking-widest text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to agents
        </button>
      </div>
    </div>
  )
}

export default function AgentDetailPage({
  agentId,
  agents,
  services = [],
  events,
  pendingApprovals,
  onRunAgent,
  isActionPending,
  updateAgentPolicy,
  runAgentLifecycleAction,
  listAgentCredentials,
  createAgentCredential,
  revokeAgentCredential,
  updateAgentCredential,
  rotateAgentCredential,
  allowServiceForAgent,
  unallowServiceForAgent,
}) {
  const [selectedServiceId, setSelectedServiceId] = useState(null)
  const agent = agents.find((a) => a.id === agentId)
  const allowedVendorIds = new Set(agent?.policy?.allowedVendorIds ?? [])
  const agentAllowedServices = agent
    ? services.filter((service) => allowedVendorIds.has(service.vendorId))
    : []

  if (!agent) {
    return <NotFound agentId={agentId} />
  }

  const agentEvents = events.filter((e) => e.agentId === agentId)
  const agentSpend = agentEvents.filter((e) => e.type === 'spend')
  const agentAudit = agentEvents.filter((e) => e.type !== 'spend')
  const agentPending = pendingApprovals.filter((p) => p.agentId === agentId)
  const latestService = agentAllowedServices.find(
    (service) => service.serviceId === agent.policy?.latestServiceId,
  )
  const selectedService =
    agentAllowedServices.find((service) => service.serviceId === selectedServiceId) ??
    latestService ??
    agentAllowedServices[0] ??
    null

  const executedSpend = agent.policy?.executedSpend ?? 0
  const blockedCount = agent.policy?.blockedCount ?? 0
  const transactionCount = agentSpend.length

  const statusTone = STATUS_TONE[agent.status] ?? STATUS_TONE.idle
  const runDisabledReason =
    agent.lifecycleStatus === 'suspended'
      ? 'Suspended'
      : agent.lifecycleStatus === 'archived'
        ? 'Archived'
        : null
  const canRunAgent = !isActionPending && !runDisabledReason

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-neutral-800 px-6 py-5">
        <button
          type="button"
          onClick={() => navigate('#dashboard/agents')}
          className="mb-4 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back to agents
        </button>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full bg-current ${statusTone}`} />
              <span className={`text-[10px] uppercase tracking-widest ${statusTone}`}>
                {agent.status}
              </span>
            </div>
            <h1 className="text-2xl font-medium text-white">{agent.name}</h1>
            <p className="mt-1 truncate font-mono text-[11px] text-neutral-500">{agent.id}</p>
          </div>
          {onRunAgent && (
            <button
              type="button"
              onClick={() => onRunAgent(agent.id)}
              disabled={!canRunAgent}
              className={`flex items-center gap-2 border px-4 py-2 text-xs uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white ${
                !canRunAgent
                  ? 'cursor-wait border-neutral-800 text-neutral-500'
                  : 'border-neutral-700 bg-neutral-900 text-white hover:bg-white hover:text-black'
              }`}
            >
              <Play className="h-3 w-3" aria-hidden="true" />
              {isActionPending ? 'Running…' : runDisabledReason ?? 'Run agent'}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 px-6 py-5 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total spent"
          value={`${formatPusd(executedSpend)} PUSD`}
        />
        <StatTile label="Transactions" value={String(transactionCount)} />
        <StatTile
          label="Pending approvals"
          value={String(agentPending.length)}
          tone={agentPending.length > 0 ? 'yellow' : 'neutral'}
        />
        <StatTile
          label="Blocked"
          value={String(blockedCount)}
          tone={blockedCount > 0 ? 'red' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 px-6 pb-6 lg:grid-cols-2">
        <Section title="Wallet & identity">
          <DetailRow label="Agent ID" value={agent.id} mono />
          <DetailRow label="Wallet backend" value={agent.policy?.walletBackend ?? 'unknown'} />
          <DetailRow label="OWS wallet" value={agent.policy?.owsWalletName} />
          <DetailRow label="Wallet state" value={agent.policy?.walletState} />
          <DetailRow label="Chain" value={agent.policy?.chain} />
          <DetailRow label="Trust tier" value={agent.trustTier} />
        </Section>

        <Section title="Policy">
          <AgentPolicyEditor
            agent={agent}
            updateAgentPolicy={updateAgentPolicy}
          />
          <div className="mt-4 border-t border-neutral-900 pt-2">
            <DetailRow
              label="Session remaining"
              value={`${formatPusd(agent.policy?.sessionRemaining)} PUSD`}
            />
            <DetailRow label="Dead-man timeout" value={agent.policy?.deadManSwitch} />
          </div>
        </Section>

        <Section title="Lifecycle">
          <AgentLifecycleControls
            agent={agent}
            runAgentLifecycleAction={runAgentLifecycleAction}
          />
        </Section>

        <Section title="Allowed services">
          <AgentServicesManager
            agent={agent}
            services={services}
            allowServiceForAgent={allowServiceForAgent}
            unallowServiceForAgent={unallowServiceForAgent}
          />
        </Section>

        <div className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-neutral-600">
                Agent wallet readiness
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                Route-specific check for this agent wallet against an allowed service.
              </p>
            </div>
            {agentAllowedServices.length > 0 && (
              <select
                aria-label="Select service for agent readiness"
                value={selectedServiceId ?? ''}
                onChange={(event) => setSelectedServiceId(event.target.value || null)}
                className="min-h-10 border border-neutral-800 bg-black px-3 text-xs text-white focus:border-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
              >
                {agentAllowedServices.map((service) => (
                  <option key={service.serviceId} value={service.serviceId}>
                    {service.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <PusdReadinessPanel
            agentId={agent.id}
            serviceId={selectedService?.serviceId}
            events={agentSpend}
            eyebrow="Agent wallet"
            title={
              selectedService
                ? `Ready to pay ${selectedService.label}`
                : 'PUSD payment readiness'
            }
            description={
              selectedService
                ? `Verifies this agent wallet can settle ${selectedService.expectedAmount} PUSD to the selected service recipient.`
                : 'Allow a service for this agent before checking real PUSD settlement.'
            }
            emptyTitle="No allowed service selected"
            emptyDescription="Agent wallet readiness is checked against a service recipient. Allow at least one service for this agent, then refresh this page."
            showSettlementSummary
          />
        </div>

        <Section
          title="SDK credentials"
          action={
            <a
              href="#dashboard/agents"
              className="hidden items-center gap-1 text-[10px] uppercase tracking-widest text-neutral-500 transition-colors hover:text-white sm:inline-flex"
            >
              Docs
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          }
        >
          {listAgentCredentials && createAgentCredential && revokeAgentCredential ? (
            <CredentialsManager
              agentId={agent.id}
              listAgentCredentials={listAgentCredentials}
              createAgentCredential={createAgentCredential}
              revokeAgentCredential={revokeAgentCredential}
              updateAgentCredential={updateAgentCredential}
              rotateAgentCredential={rotateAgentCredential}
            />
          ) : (
            <p className="text-xs text-neutral-500">
              Credential management is unavailable in offline mode.
            </p>
          )}
        </Section>

        <Section title="Recent paid calls">
          {agentSpend.length === 0 ? (
            <p className="text-xs text-neutral-500">No paid calls recorded for this agent.</p>
          ) : (
            <ul className="space-y-3">
              {agentSpend.slice(0, 6).map((event) => (
                <li
                  key={event.id}
                  className="border border-neutral-900 bg-black p-3"
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[10px] uppercase tracking-widest text-neutral-400">
                      {event.badgeLabel ?? event.result}
                    </span>
                    <span className="font-mono text-xs text-white">
                      {event.amount != null ? `${formatPusd(event.amount)} PUSD` : 'event'}
                    </span>
                  </div>
                  <div className="line-clamp-1 text-sm text-neutral-300">{event.action}</div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-neutral-600">
                    <span className="truncate">{event.vendor}</span>
                    <span className="font-mono">{event.timestamp}</span>
                  </div>
                  {event.txHashFull && (
                    <div className="mt-2 font-mono text-[10px] text-neutral-500">
                      tx: {shortHash(event.txHashFull)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent audit events">
          {agentAudit.length === 0 ? (
            <p className="text-xs text-neutral-500">No XMTP or policy events recorded.</p>
          ) : (
            <ul className="space-y-3">
              {agentAudit.slice(0, 6).map((event) => (
                <li
                  key={event.id}
                  className="border border-neutral-900 bg-black p-3"
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[10px] uppercase tracking-widest text-neutral-400">
                      {event.type}
                    </span>
                    <span className="font-mono text-[10px] text-neutral-600">
                      {event.timestamp}
                    </span>
                  </div>
                  <div className="line-clamp-1 text-sm text-neutral-300">{event.action}</div>
                  {event.reason && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-neutral-500">
                      {event.reason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}
