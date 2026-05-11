import { ArrowLeft, Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { navigate } from '../../../hooks/useHashRoute'
import SettlementBadge from './SettlementBadge'

function formatPusd(value, digits = 3) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '0.000'
}

function buildSolscanUrl(signature, chainId) {
  const cluster = chainId === 'solana-devnet' ? '?cluster=devnet' : ''
  return `https://solscan.io/tx/${signature}${cluster}`
}

async function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      return false
    }
  }
  return false
}

function CopyableSignature({
  signature,
  chainId,
  explorerUrl,
  showExplorer,
  explorerLabel = 'Open explorer',
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const ok = await copyToClipboard(signature)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <code className="block break-all border border-neutral-800 bg-black p-3 font-mono text-[11px] leading-5 text-neutral-300">
        {signature}
      </code>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-[10px] uppercase tracking-widest text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <Copy className="h-3 w-3" aria-hidden="true" />
          {copied ? 'Copied' : 'Copy signature'}
        </button>
        {showExplorer && (
          <a
            href={explorerUrl ?? buildSolscanUrl(signature, chainId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-[10px] uppercase tracking-widest text-green-300 transition-colors hover:bg-green-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            {explorerLabel}
          </a>
        )}
      </div>
    </div>
  )
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

function formatProofValue(value) {
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }
  return value ?? 'n/a'
}

function formatPrivacyPath(value) {
  if (value === 'umbra_mixer_utxo') return 'Umbra mixer/UTXO'
  if (value === 'umbra_direct_deposit') return 'Umbra direct deposit'
  if (value === 'local_mock') return 'Local mock'
  if (value === 'transparent_disabled') return 'Transparent disabled'
  return value ?? 'n/a'
}

function formatNetwork(value) {
  if (value === 'solana-devnet') return 'Solana devnet'
  if (value === 'solana-mainnet') return 'Solana mainnet'
  if (value === 'solana-local') return 'Solana localnet'
  return value ?? 'n/a'
}

function UmbraProofSection({ event }) {
  const settlement = event.umbraSettlement
  if (!settlement) return null

  return (
    <Section title="Umbra private settlement">
      <div className="mb-4 border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-[11px] leading-5 text-violet-100/80">
        Umbra devnet mixer/UTXO private settlement proof. This is an artifact-only
        audit record; it does not claim production private payments or viewing-key
        disclosure.
      </div>
      <DetailRow label="Settlement rail" value="Umbra" />
      <DetailRow label="Privacy path" value={formatPrivacyPath(settlement.privacyPath)} />
      <DetailRow label="Network" value={formatNetwork(settlement.network)} />
      <DetailRow
        label="Amount"
        value={`${settlement.amount ?? event.amount} ${settlement.assetSymbol ?? event.assetSymbol}`}
        mono
      />
      <DetailRow label="Mint" value={settlement.mint} mono />
      <DetailRow label="Report id" value={settlement.reportId} mono />
      <DetailRow
        label="Reconciliation"
        value={settlement.reconciliationStatus ?? 'pending'}
        mono
      />
      <DetailRow
        label="Disclosure posture"
        value={settlement.disclosurePosture ?? 'artifact_only'}
        mono
      />
      <DetailRow
        label="Proof source"
        value={event.proofAgentSource}
        mono
      />
      <DetailRow
        label="Synthetic proof agent"
        value={formatProofValue(event.syntheticProofAgent)}
        mono
      />
      <DetailRow
        label="Umbra policy attached"
        value={formatProofValue(event.umbraPolicyAttached)}
        mono
      />
      {settlement.finalTransactionSignature && (
        <div className="border-t border-neutral-900 pt-4">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-neutral-700">
            Final transaction
          </div>
          <CopyableSignature
            signature={settlement.finalTransactionSignature}
            chainId={settlement.network}
            explorerUrl={event.txExplorerUrl}
            showExplorer
          />
        </div>
      )}
    </Section>
  )
}

function NotFound({ executionId }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-neutral-600">
          Transaction not found
        </div>
        <h2 className="text-lg font-medium text-white">No paid call matches this id</h2>
        <p className="mt-3 break-all text-sm text-neutral-500">{executionId}</p>
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

function formatTimestampMs(ms) {
  if (!ms) return null
  return new Date(ms).toLocaleString('en-US', {
    hour12: false,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function TransactionDetailPage({
  executionId,
  events,
  agents,
  services,
}) {
  const event = events.find((e) => e.id === executionId)
  if (!event) {
    return <NotFound executionId={executionId} />
  }

  const agent = agents.find((a) => a.id === event.agentId)
  const service = services.find((s) => s.serviceId === event.serviceId)
  const isReal = event.settlementMode === 'real'
  const isUmbra = event.settlementMode === 'umbra' || Boolean(event.umbraSettlement)

  const createdAt = formatTimestampMs(event.createdAtMs)
  const updatedAt = formatTimestampMs(event.atMs)

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
            <div className="mb-2">
              <SettlementBadge mode={event.settlementMode} />
            </div>
            <h1 className="text-xl font-medium text-white sm:text-2xl">{event.action}</h1>
            <p className="mt-1 truncate font-mono text-[11px] text-neutral-500">
              {event.id}
            </p>
          </div>
          <div className="border border-neutral-800 bg-neutral-900 px-4 py-2 text-right">
            <div className="text-[10px] uppercase tracking-widest text-neutral-500">Amount</div>
            <div className="mt-1 font-mono text-lg text-white">
              {event.amount != null
                ? `${formatPusd(event.amount)} ${event.assetSymbol ?? 'PUSD'}`
                : '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-6 py-5 lg:grid-cols-2">
        <Section title="Settlement">
          <DetailRow label="Mode" value={settlementText(event.settlementMode)} />
          <DetailRow label="Status" value={event.status} mono />
          <DetailRow
            label="Policy result"
            value={event.badgeLabel ?? event.result}
          />
          <DetailRow label="Asset" value={event.assetSymbol ?? 'PUSD'} mono />
          <DetailRow label="Chain" value={event.chainId ?? 'solana-mainnet'} mono />
          {event.errorCode && (
            <DetailRow label="Error code" value={event.errorCode} mono />
          )}
          {event.errorMessage && (
            <DetailRow label="Error message" value={event.errorMessage} />
          )}
          {!event.errorMessage && event.reason && (
            <DetailRow label="Reason" value={event.reason} />
          )}
        </Section>

        <Section title="Solana transaction">
          {event.txHashFull ? (
            <>
              <div className="mb-3 text-[11px] leading-5 text-neutral-400">
                {isUmbra
                  ? 'Umbra devnet private settlement proof. The signature below is the final Solana transaction recorded by the Umbra proof run.'
                  : isReal
                    ? 'Real Solana PUSD settlement. The signature below resolves to a confirmed Solana transaction.'
                    : 'Local service-test signature. This entry is a workspace receipt, not a real Solana transaction. Configure OWS Solana payments to settle on-chain.'}
              </div>
              <CopyableSignature
                signature={event.txHashFull}
                chainId={event.chainId}
                explorerUrl={event.txExplorerUrl}
                showExplorer={isReal || isUmbra}
              />
            </>
          ) : event.settlementMode === 'approval_pending' ? (
            <p className="text-sm text-neutral-500">
              Waiting on operator approval. Once approved, the Solana transaction
              signature will appear here.
            </p>
          ) : (
            <p className="text-sm text-neutral-500">
              No transaction signature recorded for this paid call.
            </p>
          )}
        </Section>

        <Section title="Agent">
          {agent ? (
            <button
              type="button"
              onClick={() => navigate(`#dashboard/agents/${agent.id}`)}
              className="-m-2 flex w-[calc(100%+1rem)] items-center gap-3 p-2 text-left transition-colors hover:bg-neutral-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-neutral-700 bg-neutral-900 font-mono text-sm text-neutral-300">
                {agent.letter}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{agent.name}</div>
                <div className="truncate font-mono text-[10px] text-neutral-500">
                  {agent.id}
                </div>
              </div>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-neutral-600" aria-hidden="true" />
            </button>
          ) : (
            <DetailRow label="Agent" value={event.agentName} />
          )}
        </Section>

        <Section title="Service & vendor">
          <DetailRow
            label="Service"
            value={service?.label ?? event.serviceId ?? '—'}
            action={
              service ? (
                <a
                  href={`#dashboard/services/${service.serviceId}`}
                  className="shrink-0 text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                  aria-label="Open service detail"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null
            }
          />
          <DetailRow
            label="Service id"
            value={event.serviceId ?? 'n/a'}
            mono
          />
          <DetailRow label="Vendor" value={event.vendor} />
          <DetailRow label="Vendor id" value={event.vendorId ?? 'n/a'} mono />
        </Section>

        <UmbraProofSection event={event} />

        <Section title="Timestamps">
          <DetailRow label="Created" value={createdAt} />
          <DetailRow label="Updated" value={updatedAt} />
        </Section>
      </div>
    </div>
  )
}

function settlementText(mode) {
  if (mode === 'real') return 'Real Solana PUSD'
  if (mode === 'umbra') return 'Umbra private settlement'
  if (mode === 'local') return 'Local service-test'
  if (mode === 'approval_pending') return 'Approval pending'
  if (mode === 'blocked') return 'Blocked by policy'
  return 'Unknown'
}
