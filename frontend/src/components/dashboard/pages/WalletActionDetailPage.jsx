import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { navigate } from '../../../hooks/useHashRoute'
import { fetchDashboardApi } from '../../../useDashboardStore'

function formatStatus(value) {
  return (value ?? 'unknown').replaceAll('_', ' ')
}

function formatIsoTimestamp(value) {
  const parsed = Date.parse(value ?? '')
  if (!Number.isFinite(parsed)) {
    return value ?? 'n/a'
  }
  return new Date(parsed).toLocaleString('en-US', {
    hour12: false,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatTarget(target) {
  if (!target) return 'n/a'
  if (target.kind === 'address') {
    return [target.address, target.chainId, target.counterpartyId]
      .filter(Boolean)
      .join(' · ')
  }
  if (target.kind === 'wallet') {
    return [target.walletId, target.chainId].filter(Boolean).join(' · ')
  }
  if (target.kind === 'portfolio') {
    return target.portfolioId ?? 'portfolio'
  }
  if (target.kind === 'service') {
    return [target.serviceId, target.vendorId].filter(Boolean).join(' · ')
  }
  return target.kind ?? 'n/a'
}

function formatValue(value) {
  if (!value) return 'n/a'
  const amount = [value.amount, value.assetSymbol].filter(Boolean).join(' ')
  return [amount, value.chainId, value.valueUsd ? `$${value.valueUsd}` : null]
    .filter(Boolean)
    .join(' · ')
}

function countOf(list) {
  return Array.isArray(list) ? list.length : 0
}

function formatAuditMetadata(metadata) {
  if (!metadata) return null
  const parts = [
    metadata.decision ? `decision:${metadata.decision}` : null,
    metadata.resultKind ? `result:${metadata.resultKind}` : null,
    metadata.actionRequestKind ? `kind:${metadata.actionRequestKind}` : null,
    metadata.errorCode ? `error:${metadata.errorCode}` : null,
  ]
  return parts.filter(Boolean).join(' · ') || null
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

function DetailRow({ label, value, mono }) {
  return (
    <div className="border-b border-neutral-900 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="text-[10px] uppercase tracking-widest text-neutral-700">{label}</div>
      <div
        className={`mt-1 break-all text-sm text-neutral-300 ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value ?? 'n/a'}
      </div>
    </div>
  )
}

function StatusPill({ status }) {
  return (
    <span className="inline-flex items-center border border-neutral-700 bg-neutral-900 px-2 py-1 text-[10px] uppercase tracking-widest text-neutral-300">
      {formatStatus(status)}
    </span>
  )
}

function CompactState({ tone = 'neutral', heading, detail }) {
  const headingTone = tone === 'error' ? 'text-red-300' : 'text-white'
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-neutral-600">
          Wallet action
        </div>
        <h2 className={`text-lg font-medium ${headingTone}`}>{heading}</h2>
        {detail && (
          <p className="mt-3 break-all text-sm text-neutral-500">{detail}</p>
        )}
        <button
          type="button"
          onClick={() => navigate('#dashboard/transactions')}
          className="mt-5 inline-flex items-center gap-2 border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs uppercase tracking-widest text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to transactions
        </button>
      </div>
    </div>
  )
}

export default function WalletActionDetailPage({ walletActionId, agents = [] }) {
  const [state, setState] = useState({ status: 'idle', detail: null, error: null })

  useEffect(() => {
    if (!walletActionId) {
      setState({ status: 'error', detail: null, error: 'Missing wallet action id.' })
      return undefined
    }

    let cancelled = false
    setState({ status: 'loading', detail: null, error: null })

    async function load() {
      try {
        const response = await fetchDashboardApi(
          `/api/dashboard/wallet-actions/${encodeURIComponent(walletActionId)}`,
          { cache: 'no-store' },
        )
        const payload = await response.json().catch(() => null)
        if (cancelled) return
        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ||
              payload?.error ||
              `Unable to load wallet action detail (${response.status})`,
          )
        }
        setState({ status: 'loaded', detail: payload, error: null })
      } catch (error) {
        if (cancelled) return
        setState({
          status: 'error',
          detail: null,
          error:
            error instanceof Error
              ? error.message
              : 'Unable to load wallet action detail.',
        })
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [walletActionId])

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <CompactState heading="Loading wallet action…" detail={walletActionId} />
    )
  }

  if (state.status === 'error') {
    return (
      <CompactState
        tone="error"
        heading="Wallet action unavailable"
        detail={state.error ?? walletActionId}
      />
    )
  }

  const detail = state.detail
  const walletAction = detail?.walletAction
  if (!walletAction) {
    return (
      <CompactState
        heading="No wallet action matches this id"
        detail={walletActionId}
      />
    )
  }

  const execution = walletAction.execution ?? {}
  const approval = walletAction.approval ?? {}
  const request = detail.actionRequest
  const runtime = request?.runtime
  const auditTrail = request?.auditTrail ?? []
  const agentName =
    detail.agent?.displayName ??
    agents.find((agent) => agent.id === walletAction.agentId)?.name ??
    walletAction.agentId
  const walletId = walletAction.walletId ?? detail.wallet?.walletId

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-neutral-800 px-6 py-5">
        <button
          type="button"
          onClick={() => navigate('#dashboard/transactions')}
          className="mb-4 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back to transactions
        </button>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center border border-violet-500/30 bg-violet-500/5 px-2 py-1 text-[10px] uppercase tracking-widest text-violet-200">
                {walletAction.kind}
              </span>
              <StatusPill status={walletAction.status} />
            </div>
            <h1 className="text-xl font-medium text-white sm:text-2xl">
              {walletAction.title || formatStatus(walletAction.kind)}
            </h1>
            <p className="mt-1 truncate font-mono text-[11px] text-neutral-500">
              {walletAction.walletActionId}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-6 py-5 lg:grid-cols-2">
        <Section title="Wallet action">
          <DetailRow label="Kind" value={walletAction.kind} mono />
          <DetailRow label="Status" value={formatStatus(walletAction.status)} mono />
          <DetailRow label="Source" value={walletAction.source} mono />
          <DetailRow label="Agent" value={`${agentName} · ${walletAction.agentId}`} mono />
          <DetailRow label="Wallet id" value={walletId} mono />
          <DetailRow label="Summary" value={walletAction.summary} />
        </Section>

        <Section title="Target & value">
          <DetailRow label="Target" value={formatTarget(walletAction.target)} mono />
          <DetailRow label="Value" value={formatValue(walletAction.value)} mono />
          <DetailRow
            label="Approval"
            value={
              approval.required
                ? approval.reason ?? 'required'
                : 'not required'
            }
          />
          <DetailRow label="Approval state ref" value={approval.approvalStateRef} mono />
          <DetailRow label="Created" value={formatIsoTimestamp(walletAction.createdAt)} />
          <DetailRow label="Updated" value={formatIsoTimestamp(walletAction.updatedAt)} />
        </Section>

        <Section title="Execution refs">
          <DetailRow
            label="Connector"
            value={[execution.connectorKind, execution.connectorId]
              .filter(Boolean)
              .join(' · ')}
            mono
          />
          <DetailRow label="Execution mode" value={execution.executionMode} mono />
          <DetailRow label="Privacy mode" value={execution.privacyMode} mono />
          <DetailRow label="Result ref" value={execution.resultRef} mono />
          <DetailRow label="Transaction ref" value={execution.transactionRef} mono />
          <DetailRow label="Run id" value={execution.runId} mono />
          <DetailRow label="Session id" value={execution.sessionId} mono />
          <DetailRow
            label="Refs"
            value={`intents:${countOf(execution.intentIds)} · sim:${countOf(
              execution.simulationRefs,
            )} · broadcast:${countOf(execution.broadcastRefs)}`}
            mono
          />
          {execution.errorCode && (
            <DetailRow label="Error code" value={execution.errorCode} mono />
          )}
          {execution.errorMessage && (
            <DetailRow label="Error message" value={execution.errorMessage} />
          )}
        </Section>

        <Section title="Runtime refs">
          {runtime ? (
            <>
              <DetailRow
                label="Run"
                value={
                  runtime.runId
                    ? `${runtime.runId} · ${runtime.found ? runtime.status ?? 'found' : 'not found'}`
                    : runtime.found
                      ? runtime.status ?? 'found'
                      : 'not linked'
                }
                mono
              />
              <DetailRow label="Current phase" value={runtime.currentPhase} mono />
              <DetailRow
                label="Refs"
                value={`sim:${countOf(runtime.refs?.simulationRefs)} · sign:${countOf(
                  runtime.refs?.signatureRequestRefs,
                )} · result:${countOf(
                  runtime.refs?.signatureResultRefs,
                )} · broadcast:${countOf(runtime.refs?.broadcastRefs)}`}
                mono
              />
              <DetailRow
                label="Last updated"
                value={runtime.lastUpdatedAt ? formatIsoTimestamp(runtime.lastUpdatedAt) : null}
              />
            </>
          ) : (
            <p className="text-sm text-neutral-500">
              No runtime detail linked to this wallet action.
            </p>
          )}
          {detail.provenance && (
            <DetailRow
              label="Provenance"
              value={
                detail.provenance.legacyPaidCallDerived
                  ? 'legacy PaidCall derived'
                  : detail.provenance.nativeActionRequest
                    ? 'native action request'
                    : 'unknown'
              }
              mono
            />
          )}
        </Section>

        {auditTrail.length > 0 && (
          <div className="lg:col-span-2">
            <Section title="Operator audit trail">
              <div className="space-y-3">
                {auditTrail.map((entry) => {
                  const metadata = formatAuditMetadata(entry.metadata)
                  return (
                    <div
                      key={entry.auditLogId}
                      className="border border-neutral-900 bg-black/40 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
                          {entry.action} · {entry.status}
                        </span>
                        <span className="font-mono text-[10px] text-neutral-600">
                          {formatIsoTimestamp(entry.at)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-neutral-300">
                        {entry.summary}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-neutral-600">
                        <span>{entry.actorId}</span>
                        <span>{entry.operatorRole}</span>
                        {metadata && <span>{metadata}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}
