import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Server,
  ShieldCheck,
} from 'lucide-react'
import { createElement } from 'react'

const API_BASE_URL = import.meta.env.VITE_DASHBOARD_API_BASE_URL || 'same origin'

function formatPusd(value, digits = 2) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '0.00'
}

function Section({ title, description, children }) {
  return (
    <section className="border border-neutral-800 bg-neutral-950">
      <div className="border-b border-neutral-900 px-5 py-3">
        <h2 className="text-[10px] uppercase tracking-widest text-neutral-500">{title}</h2>
        {description && (
          <p className="mt-1 text-[11px] leading-5 text-neutral-600">{description}</p>
        )}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function DetailRow({ label, value, mono, action }) {
  return (
    <div className="border-b border-neutral-900 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="text-[10px] uppercase tracking-widest text-neutral-700">{label}</div>
      <div
        className={`mt-1 flex items-center gap-2 break-words text-sm text-neutral-300 ${
          mono ? 'font-mono text-xs' : ''
        }`}
      >
        <span className="min-w-0 break-all">{value ?? 'n/a'}</span>
        {action}
      </div>
    </div>
  )
}

function SummaryTile({ icon, label, value, tone = 'neutral' }) {
  const toneClass =
    tone === 'green'
      ? 'text-green-400'
      : tone === 'yellow'
        ? 'text-yellow-300'
        : 'text-white'

  return (
    <div className="border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-widest text-neutral-700">{label}</div>
        {createElement(icon, {
          className: 'h-4 w-4 text-neutral-600',
          'aria-hidden': true,
        })}
      </div>
      <div className={`mt-2 font-mono text-lg tabular-nums ${toneClass}`}>{value}</div>
    </div>
  )
}

function LinkRow({ href, title, description }) {
  return (
    <a
      href={href}
      className="flex min-h-10 items-center justify-between gap-3 border-b border-neutral-900 py-3 text-left transition-colors last:border-b-0 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
    >
      <span className="min-w-0">
        <span className="block text-sm text-neutral-300">{title}</span>
        <span className="mt-1 block text-[11px] leading-5 text-neutral-600">
          {description}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-neutral-600" aria-hidden="true" />
    </a>
  )
}

export default function SettingsPage({ agents, services, events }) {
  const activeAgents = agents.filter((agent) => agent.status === 'active').length
  const owsAgents = agents.filter((agent) => agent.policy?.walletBackend === 'ows').length
  const registeredServices = services.filter((service) => service.source === 'registered')
  const pendingApprovals = events.filter(
    (event) => event.settlementMode === 'approval_pending',
  ).length
  const realSettlements = events.filter((event) => event.settlementMode === 'real').length
  const firstAgent = agents[0]
  const firstService = services[0]
  const defaultPolicy = firstAgent?.policy

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-neutral-800 px-6 py-5">
        <div className="text-[10px] uppercase tracking-widest text-neutral-600">
          Settings
        </div>
        <h1 className="mt-1 text-xl font-medium text-white">Workspace controls</h1>
        <p className="mt-1 max-w-prose text-[11px] leading-5 text-neutral-500">
          Workspace defaults, SDK configuration, and system health. Wallet readiness is
          scoped to agent and service detail pages.
        </p>
      </div>

      <div className="grid gap-4 px-6 py-5 md:grid-cols-2 xl:grid-cols-4">
        <SummaryTile icon={ShieldCheck} label="Agents" value={String(agents.length)} />
        <SummaryTile
          icon={CheckCircle2}
          label="Active agents"
          value={String(activeAgents)}
          tone={activeAgents > 0 ? 'green' : 'neutral'}
        />
        <SummaryTile icon={Server} label="Services" value={String(services.length)} />
        <SummaryTile
          icon={AlertTriangle}
          label="Pending approvals"
          value={String(pendingApprovals)}
          tone={pendingApprovals > 0 ? 'yellow' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 px-6 pb-6 lg:grid-cols-2">
        <Section
          title="Default policy template"
          description="Current defaults inferred from the first created agent until workspace templates are editable."
        >
          <DetailRow
            label="Session budget"
            value={
              defaultPolicy
                ? `${formatPusd(defaultPolicy.sessionBudget)} PUSD`
                : 'No agent policy yet'
            }
          />
          <DetailRow
            label="Max per call"
            value={
              defaultPolicy
                ? `${formatPusd(defaultPolicy.maxPerCall)} PUSD`
                : 'No agent policy yet'
            }
          />
          <DetailRow
            label="Auto approval"
            value={
              defaultPolicy
                ? `${formatPusd(defaultPolicy.autoApproveMax)} PUSD`
                : 'No agent policy yet'
            }
          />
          <DetailRow
            label="Allowed services"
            value={(defaultPolicy?.vendors ?? []).join(', ') || 'No defaults yet'}
          />
        </Section>

        <Section
          title="SDK and API"
          description="Workspace-level connection details for external agents."
        >
          <DetailRow label="Dashboard API base URL" value={API_BASE_URL} mono />
          <DetailRow label="SDK auth header" value="X-PalmOS-Agent-Key" mono />
          <DetailRow label="SDK docs" value="sdk.md" mono />
          <DetailRow
            label="Credential scope"
            value="Agent-specific credentials are managed on each agent detail page."
          />
        </Section>

        <Section
          title="System health"
          description="High-level workspace status without pretending wallets are global."
        >
          <DetailRow label="OWS-backed agents" value={String(owsAgents)} mono />
          <DetailRow label="Registered services" value={String(registeredServices.length)} mono />
          <DetailRow label="Real Solana settlements" value={String(realSettlements)} mono />
          <DetailRow
            label="Recipient ownership"
            value="Recipient wallets are configured per service."
          />
        </Section>

        <Section
          title="Scoped readiness"
          description="Open the correct detail view to inspect wallet or recipient readiness."
        >
          {firstAgent ? (
            <LinkRow
              href={`#dashboard/agents/${firstAgent.id}`}
              title="Agent wallet readiness"
              description={`Inspect payer readiness for ${firstAgent.name}.`}
            />
          ) : (
            <LinkRow
              href="#dashboard/onboarding"
              title="Create first agent"
              description="Create an agent before checking payer wallet readiness."
            />
          )}
          {firstService ? (
            <LinkRow
              href={`#dashboard/services/${firstService.serviceId}`}
              title="Service recipient readiness"
              description={`Inspect recipient readiness for ${firstService.label}.`}
            />
          ) : (
            <LinkRow
              href="#dashboard/services"
              title="Register service"
              description="Register or load a service before checking recipient readiness."
            />
          )}
          <a
            href="sdk.md"
            className="flex min-h-10 items-center justify-between gap-3 pt-3 text-sm text-neutral-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            <span className="inline-flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-neutral-600" aria-hidden="true" />
              SDK setup guide
            </span>
            <ExternalLink className="h-4 w-4 text-neutral-600" aria-hidden="true" />
          </a>
        </Section>
      </div>
    </div>
  )
}
