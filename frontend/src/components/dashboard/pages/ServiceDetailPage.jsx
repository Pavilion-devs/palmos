import { ArrowLeft, ExternalLink, Info } from 'lucide-react'
import { useState } from 'react'
import { navigate } from '../../../hooks/useHashRoute'

function compactAddress(value) {
  if (!value) return null
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

function Section({ title, children }) {
  return (
    <section className="border border-neutral-800 bg-neutral-950">
      <div className="border-b border-neutral-900 px-5 py-3">
        <h2 className="text-[10px] uppercase tracking-widest text-neutral-500">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function DetailRow({ label, value, mono, valueAddon }) {
  return (
    <div className="border-b border-neutral-900 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="text-[10px] uppercase tracking-widest text-neutral-700">{label}</div>
      <div
        className={`mt-1 flex items-center gap-2 break-words text-sm text-neutral-300 ${
          mono ? 'font-mono text-xs' : ''
        }`}
      >
        <span className="min-w-0 break-all">{value ?? 'n/a'}</span>
        {valueAddon}
      </div>
    </div>
  )
}

function NotFound({ serviceId }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-neutral-600">
          Service not found
        </div>
        <h2 className="text-lg font-medium text-white">No service matches this id</h2>
        <p className="mt-3 break-all text-sm text-neutral-500">{serviceId}</p>
        <button
          type="button"
          onClick={() => navigate('#dashboard/services')}
          className="mt-5 inline-flex items-center gap-2 border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs uppercase tracking-widest text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to services
        </button>
      </div>
    </div>
  )
}

function AllowAgentRow({ agent, isAllowed, onAllow }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function handleAllow() {
    setPending(true)
    setError('')
    try {
      await onAllow(agent.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to allow service')
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 border border-neutral-900 bg-black p-3 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={() => navigate(`#dashboard/agents/${agent.id}`)}
        className="flex min-w-0 items-center gap-3 text-left transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-neutral-700 bg-neutral-900 font-mono text-xs text-neutral-300">
          {agent.letter}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm text-neutral-300">{agent.name}</div>
          <div className="truncate font-mono text-[10px] text-neutral-600">{agent.id}</div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-2">
        {error && <span className="text-[11px] text-red-400">{error}</span>}
        {isAllowed ? (
          <span className="border border-green-500/20 bg-green-500/5 px-3 py-1.5 text-[10px] uppercase tracking-widest text-green-400">
            ✓ Allowed
          </span>
        ) : (
          <button
            type="button"
            onClick={handleAllow}
            disabled={pending}
            className="border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-[10px] uppercase tracking-widest text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? 'Allowing…' : 'Allow'}
          </button>
        )}
      </div>
    </li>
  )
}

export default function ServiceDetailPage({
  serviceId,
  services,
  agents,
  allowServiceForAgent,
}) {
  const service = services.find((s) => s.serviceId === serviceId)
  const allowedAgents = service
    ? agents.filter((agent) =>
        (agent.policy?.allowedVendorIds ?? []).includes(service.vendorId),
      )
    : []

  if (!service) {
    return <NotFound serviceId={serviceId} />
  }

  const isRegistered = service.source === 'registered'
  const registered = service.registered

  const otherAgents = agents.filter(
    (agent) => !(agent.policy?.allowedVendorIds ?? []).includes(service.vendorId),
  )
  const siblingServices = services.filter(
    (other) =>
      other.vendorId === service.vendorId && other.serviceId !== service.serviceId,
  )

  const fullAddress = registered?.destinationAddress
  const compactDestination = fullAddress ? compactAddress(fullAddress) : null

  async function handleAllow(agentId) {
    if (!allowServiceForAgent) return
    await allowServiceForAgent(agentId, service.serviceId)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-neutral-800 px-6 py-5">
        <button
          type="button"
          onClick={() => navigate('#dashboard/services')}
          className="mb-4 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back to services
        </button>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[10px] uppercase tracking-widest text-neutral-400">
                {isRegistered ? 'registered' : 'built-in'}
              </span>
            </div>
            <h1 className="text-2xl font-medium text-white">{service.label}</h1>
            <p className="mt-1 truncate font-mono text-[11px] text-neutral-500">
              {service.serviceId}
            </p>
          </div>
          <div className="flex items-center gap-2 border border-neutral-800 bg-neutral-900 px-4 py-2">
            <span className="text-[10px] uppercase tracking-widest text-neutral-500">Price</span>
            <span className="font-mono text-sm text-white">
              {service.expectedAmount} PUSD
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-6 py-5 lg:grid-cols-2">
        <Section title="Endpoint">
          <DetailRow label="Service id" value={service.serviceId} mono />
          <DetailRow label="Vendor id" value={service.vendorId} mono />
          <DetailRow
            label="Endpoint URL"
            value={registered?.endpointUrl ?? 'built-in service'}
            mono
            valueAddon={
              registered?.endpointUrl ? (
                <a
                  href={registered.endpointUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                  aria-label="Open endpoint in new tab"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null
            }
          />
          <DetailRow
            label="Method"
            value={registered?.method ?? 'GET'}
            mono
          />
        </Section>

        <Section title="Settlement">
          <DetailRow
            label="Recipient wallet"
            value={compactDestination ?? 'managed by PalmOS'}
            mono
            valueAddon={
              fullAddress ? (
                <a
                  href={`https://solscan.io/account/${fullAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                  aria-label="Open recipient on Solscan"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null
            }
          />
          <DetailRow
            label="Asset"
            value={service.assetSymbol ?? 'PUSD'}
            mono
          />
          <DetailRow label="Chain" value={service.chainId} mono />
          <DetailRow
            label="Source"
            value={isRegistered ? 'Registered by workspace' : 'Built into PalmOS'}
          />
          {registered?.status && (
            <DetailRow label="Registry status" value={registered.status} />
          )}
        </Section>
      </div>

      <div className="px-6 pb-6">
        <Section title="Agent allowlist">
          <div className="mb-5 flex items-start gap-2 border border-neutral-800 bg-black px-3 py-2.5 text-[11px] leading-5 text-neutral-400">
            <Info
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-600"
              aria-hidden="true"
            />
            <p>
              PalmOS allowlist is scoped to vendor{' '}
              <span className="font-mono text-neutral-200">{service.vendorId}</span>, not
              this specific service. Allowing it for an agent grants the agent access to
              every service that ships under this vendor.
              {siblingServices.length > 0 && (
                <>
                  {' '}Currently includes{' '}
                  {siblingServices.map((sibling, index) => (
                    <span key={sibling.serviceId}>
                      {index > 0 && ', '}
                      <a
                        href={`#dashboard/services/${sibling.serviceId}`}
                        className="font-mono text-neutral-200 underline-offset-2 hover:underline"
                      >
                        {sibling.serviceId}
                      </a>
                    </span>
                  ))}
                  .
                </>
              )}
            </p>
          </div>

          {agents.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No agents registered yet. Register an external agent to allow this service for it.
            </p>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-neutral-600">
                    Allowed
                  </span>
                  <span className="font-mono text-xs text-neutral-700">
                    {allowedAgents.length}
                  </span>
                </div>
                {allowedAgents.length === 0 ? (
                  <p className="text-xs text-neutral-500">No agents are allowed yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {allowedAgents.map((agent) => (
                      <AllowAgentRow
                        key={agent.id}
                        agent={agent}
                        isAllowed
                        onAllow={handleAllow}
                      />
                    ))}
                  </ul>
                )}
              </div>

              {otherAgents.length > 0 && (
                <div>
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className="text-[10px] uppercase tracking-widest text-neutral-600">
                      Available to allow
                    </span>
                    <span className="font-mono text-xs text-neutral-700">
                      {otherAgents.length}
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {otherAgents.map((agent) => (
                      <AllowAgentRow
                        key={agent.id}
                        agent={agent}
                        isAllowed={false}
                        onAllow={handleAllow}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Section>
      </div>
    </div>
  )

}
