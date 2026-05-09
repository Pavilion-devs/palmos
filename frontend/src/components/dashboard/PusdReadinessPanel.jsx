import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCcw,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_DASHBOARD_API_BASE_URL || ''

const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const OFFICIAL_PUSD_MINT = 'CZzgUBvxaMLwMhVSLgqJn3npmxoTo6nzMNQPAnwtHF3s'

function buildApiUrl(path) {
  if (!API_BASE_URL) return path
  return `${API_BASE_URL}${path}`
}

function buildSolscanAccount(address, chainId) {
  const cluster = chainId === 'solana-devnet' ? '?cluster=devnet' : ''
  return `https://solscan.io/account/${address}${cluster}`
}

function compactAddress(value) {
  if (!value) return null
  return value.length > 20 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value
}

function formatLamportsAsSol(lamports) {
  if (typeof lamports !== 'number') return null
  return (lamports / 1_000_000_000).toFixed(6)
}

function formatPusdBaseUnits(baseUnits) {
  if (baseUnits == null) return null
  try {
    const bigInt = BigInt(baseUnits)
    const whole = bigInt / 1_000_000n
    const fraction = bigInt % 1_000_000n
    const fractionStr = fraction.toString().padStart(6, '0')
    return `${whole}.${fractionStr}`
  } catch {
    return null
  }
}

function settlementSummary(events) {
  const realCount = events.filter((e) => e.settlementMode === 'real').length
  const localCount = events.filter((e) => e.settlementMode === 'local').length
  const blockedCount = events.filter((e) => e.settlementMode === 'blocked').length
  const pendingCount = events.filter(
    (e) => e.settlementMode === 'approval_pending',
  ).length
  return { realCount, localCount, blockedCount, pendingCount }
}

function hasRecipientAtaCheck(report) {
  const check = report?.checks?.find((c) => c.checkId === 'pusd.recipient.ata_exists')
  return check?.status ?? null
}

function StatusBanner({ ok, hasReport, error, refreshing }) {
  if (refreshing && !hasReport) {
    return (
      <div className="border border-neutral-800 bg-neutral-950 px-5 py-4">
        <div className="flex items-center gap-3">
          <RefreshCcw className="h-4 w-4 animate-spin text-neutral-500" aria-hidden="true" />
          <span className="text-sm text-neutral-400">Checking PUSD readiness...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-red-500/30 bg-red-500/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-red-300">
              Readiness check unavailable
            </div>
            <p className="mt-1 text-sm text-red-300">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!hasReport) {
    return (
      <div className="border border-neutral-800 bg-neutral-950 px-5 py-4">
        <p className="text-sm text-neutral-500">No readiness report has been collected yet.</p>
      </div>
    )
  }

  if (ok) {
    return (
      <div className="border border-green-500/30 bg-green-500/5 px-5 py-4">
        <div className="flex items-start gap-3">
          <CheckCircle2
            className="mt-0.5 h-5 w-5 shrink-0 text-green-400"
            aria-hidden="true"
          />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-green-300">
              Ready
            </div>
            <p className="mt-1 text-sm text-green-200">
              This agent-service route can settle PUSD on Solana with the current
              payer, recipient, mint, and RPC configuration.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-yellow-500/30 bg-yellow-500/5 px-5 py-4">
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-yellow-300"
          aria-hidden="true"
        />
        <div>
          <div className="text-[10px] uppercase tracking-widest text-yellow-300">
            Not ready
          </div>
          <p className="mt-1 text-sm text-yellow-200">
            One or more readiness checks failed. Resolve the route-specific checks
            before relying on real PUSD settlement.
          </p>
        </div>
      </div>
    </div>
  )
}

function Section({ title, description, children }) {
  return (
    <section className="border border-neutral-800 bg-neutral-950">
      <div className="border-b border-neutral-900 px-5 py-3">
        <h2 className="text-[10px] uppercase tracking-widest text-neutral-500">{title}</h2>
        {description && (
          <p className="mt-1 text-[11px] text-neutral-600">{description}</p>
        )}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function DetailRow({ label, value, mono, action, valueClassName }) {
  return (
    <div className="border-b border-neutral-900 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="text-[10px] uppercase tracking-widest text-neutral-700">{label}</div>
      <div
        className={`mt-1 flex items-center gap-2 break-words text-sm text-neutral-300 ${
          mono ? 'font-mono text-xs' : ''
        } ${valueClassName ?? ''}`}
      >
        <span className="min-w-0 break-all">{value ?? 'n/a'}</span>
        {action}
      </div>
    </div>
  )
}

function AddressRow({ label, address, chainId }) {
  const [copied, setCopied] = useState(false)

  async function copyAddress() {
    if (!address || !navigator.clipboard) return
    await navigator.clipboard.writeText(address)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  if (!address) {
    return <DetailRow label={label} value="not configured" />
  }

  return (
    <DetailRow
      label={label}
      value={compactAddress(address)}
      mono
      action={
        <>
          <button
            type="button"
            onClick={copyAddress}
            className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            aria-label={`Copy ${label}`}
            title={address}
          >
            {copied ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-400" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
          <a
            href={buildSolscanAccount(address, chainId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            aria-label={`Open ${label} on Solscan`}
            title={address}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </>
      }
    />
  )
}

function CheckRow({ check }) {
  let icon
  let toneClass
  if (check.status === 'passed') {
    icon = <CheckCircle2 className="h-4 w-4 text-green-400" aria-hidden="true" />
    toneClass = 'border-green-500/20'
  } else if (check.status === 'warning') {
    icon = <AlertTriangle className="h-4 w-4 text-yellow-300" aria-hidden="true" />
    toneClass = 'border-yellow-500/20'
  } else {
    icon = <XCircle className="h-4 w-4 text-red-400" aria-hidden="true" />
    toneClass = 'border-red-500/20'
  }

  const detailEntries = check.details
    ? Object.entries(check.details).filter(([, value]) => value != null)
    : []

  return (
    <li className={`flex items-start gap-3 border bg-black p-3 ${toneClass}`}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <code className="truncate font-mono text-[11px] text-neutral-400">
            {check.checkId}
          </code>
          <span
            className={`shrink-0 text-[10px] uppercase tracking-widest ${
              check.status === 'passed'
                ? 'text-green-400'
                : check.status === 'warning'
                  ? 'text-yellow-300'
                  : 'text-red-400'
            }`}
          >
            {check.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-neutral-300">{check.summary}</p>
        {detailEntries.length > 0 && (
          <dl className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-neutral-500 sm:grid-cols-2">
            {detailEntries.map(([key, value]) => (
              <div key={key} className="flex min-w-0 items-baseline gap-2">
                <dt className="shrink-0 font-mono text-neutral-700">{key}</dt>
                <dd className="min-w-0 break-all font-mono">{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  )
}

function EmptyReadiness({ title, description, action }) {
  return (
    <section className="border border-neutral-800 bg-neutral-950 p-5">
      <div className="text-[10px] uppercase tracking-widest text-neutral-600">
        Readiness unavailable
      </div>
      <h2 className="mt-2 text-sm font-medium text-white">{title}</h2>
      <p className="mt-2 max-w-prose text-sm leading-6 text-neutral-500">{description}</p>
      {action}
    </section>
  )
}

export default function PusdReadinessPanel({
  agentId,
  serviceId,
  events = [],
  title = 'PUSD readiness',
  eyebrow = 'Settlement route',
  description = 'Live check against the configured Solana RPC for this agent-service route.',
  emptyTitle = 'Select an agent and service',
  emptyDescription = 'Readiness is scoped to one paying agent and one recipient service.',
  emptyAction,
  showSettlementSummary = false,
}) {
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)

  const canCheck = Boolean(agentId && serviceId)

  useEffect(() => {
    if (!canCheck) {
      setReport(null)
      setError('')
      setRefreshing(false)
      return undefined
    }

    let cancelled = false

    async function load() {
      setRefreshing(true)
      setError('')
      try {
        const params = new URLSearchParams()
        params.set('agentId', agentId)
        params.set('serviceId', serviceId)
        const response = await fetch(
          buildApiUrl(`/api/dashboard/pusd/readiness?${params.toString()}`),
          { cache: 'no-store', credentials: 'include' },
        )
        const payload = await response.json().catch(() => null)
        if (cancelled) return

        if (!response.ok) {
          setError(payload?.error || `Readiness check failed (${response.status})`)
          setReport(null)
        } else if (!payload?.report) {
          setError(payload?.error || 'No readiness report returned.')
          setReport(null)
        } else {
          setReport(payload.report)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Readiness check failed')
          setReport(null)
        }
      } finally {
        if (!cancelled) setRefreshing(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [agentId, canCheck, refreshNonce, serviceId])

  if (!canCheck) {
    return (
      <EmptyReadiness
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    )
  }

  const ok = Boolean(report?.checks?.every((check) => check.status !== 'failed'))
  const hasReport = Boolean(report)
  const isToken2022 = report?.tokenProgramId === TOKEN_2022_PROGRAM_ID
  const isOfficialMint = report?.mint === OFFICIAL_PUSD_MINT
  const chainId = report?.rpcUrl?.includes('devnet') ? 'solana-devnet' : 'solana-mainnet'
  const summary = settlementSummary(events.filter((e) => e.type === 'spend'))
  const solBalance = formatLamportsAsSol(report?.solBalanceLamports)
  const pusdBalance = formatPusdBaseUnits(report?.pusdBalanceBaseUnits)

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border border-neutral-800 bg-neutral-950 px-5 py-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-neutral-600">
            {eyebrow}
          </div>
          <h2 className="mt-1 text-sm font-medium text-white">{title}</h2>
          <p className="mt-1 max-w-prose text-[11px] leading-5 text-neutral-500">
            {description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshNonce((value) => value + 1)}
          disabled={refreshing}
          className="inline-flex min-h-10 items-center gap-2 border border-neutral-700 bg-neutral-900 px-3 text-xs uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-wait disabled:opacity-60"
          aria-busy={refreshing}
        >
          <RefreshCcw
            className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {refreshing ? 'Checking' : 'Refresh'}
        </button>
      </div>

      <StatusBanner ok={ok} hasReport={hasReport} error={error} refreshing={refreshing} />

      <div className="grid gap-4 lg:grid-cols-2">
        {showSettlementSummary && (
          <Section
            title="Settlement mode observed"
            description="Aggregated from recorded paid calls for this context."
          >
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Real Solana PUSD', summary.realCount, summary.realCount > 0 ? 'text-green-400' : 'text-neutral-400'],
                ['Local service-test', summary.localCount, 'text-neutral-300'],
                ['Approval pending', summary.pendingCount, 'text-neutral-300'],
                ['Blocked', summary.blockedCount, 'text-neutral-300'],
              ].map(([label, value, tone]) => (
                <div key={label} className="border border-neutral-900 bg-black px-3 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-neutral-700">
                    {label}
                  </div>
                  <div className={`mt-1 font-mono text-lg tabular-nums ${tone}`}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="PUSD configuration" description="Mint and token program in use.">
          <DetailRow label="RPC URL" value={report?.rpcUrl} mono />
          <DetailRow
            label="PUSD mint"
            value={compactAddress(report?.mint)}
            mono
            action={
              report?.mint ? (
                <a
                  href={buildSolscanAccount(report.mint, chainId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                  aria-label="Open mint on Solscan"
                  title={report.mint}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null
            }
            valueClassName={isOfficialMint ? 'text-green-300' : ''}
          />
          <DetailRow
            label="Mint identity"
            value={
              report
                ? isOfficialMint
                  ? 'Matches the official Palm USD mint'
                  : 'Custom or non-official mint'
                : null
            }
            valueClassName={isOfficialMint ? 'text-green-300' : 'text-yellow-300'}
          />
          <DetailRow
            label="Token program"
            value={compactAddress(report?.tokenProgramId)}
            mono
            action={
              report?.tokenProgramId ? (
                <a
                  href={buildSolscanAccount(report.tokenProgramId, chainId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                  aria-label="Open token program on Solscan"
                  title={report.tokenProgramId}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null
            }
          />
          <DetailRow
            label="Token program identity"
            value={
              report
                ? isToken2022
                  ? 'Token-2022'
                  : 'Legacy SPL token program'
                : null
            }
            valueClassName={isToken2022 ? 'text-green-300' : 'text-yellow-300'}
          />
          <DetailRow label="Test amount" value={report?.amount && `${report.amount} PUSD`} />
        </Section>

        <Section title="Agent wallet" description="Payer identity for this route.">
          <AddressRow label="Address" address={report?.payer} chainId={chainId} />
          <DetailRow
            label="SOL balance"
            value={solBalance ? `${solBalance} SOL` : null}
            mono
          />
          <DetailRow
            label="PUSD balance"
            value={pusdBalance ? `${pusdBalance} PUSD` : null}
            mono
          />
          <AddressRow
            label="PUSD token account"
            address={report?.payerTokenAccount}
            chainId={chainId}
          />
        </Section>

        <Section title="Service recipient" description="Recipient identity for this service.">
          <AddressRow label="Address" address={report?.recipient} chainId={chainId} />
          <AddressRow
            label="PUSD token account"
            address={report?.recipientTokenAccount}
            chainId={chainId}
          />
          <DetailRow
            label="ATA bootstrap"
            value={
              report
                ? hasRecipientAtaCheck(report) === 'warning'
                  ? 'Will be created on first transfer'
                  : hasRecipientAtaCheck(report) === 'passed'
                    ? 'Already exists on Solana'
                    : 'Unknown'
                : null
            }
            valueClassName={
              hasRecipientAtaCheck(report) === 'passed' ? 'text-green-300' : ''
            }
          />
        </Section>
      </div>

      <Section
        title="Readiness checks"
        description="Each check is run live against Solana when this panel is refreshed."
      >
        {report?.checks?.length ? (
          <ul className="space-y-2">
            {report.checks.map((check) => (
              <CheckRow key={check.checkId} check={check} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">
            No checks were returned for this route.
          </p>
        )}
      </Section>
    </section>
  )
}
