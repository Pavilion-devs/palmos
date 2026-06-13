import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  Pencil,
  ArrowLeftRight,
  Send,
  Coins,
  KeyRound,
  ShieldAlert,
  Activity as ActivityIcon,
  Zap,
  ArrowDownToLine,
  Droplets,
  ExternalLink,
} from 'lucide-react'
import { Shell } from './Shell'
import { useAgentWallets } from '../../hooks/useAgentWallets'
import useDashboardTransactions from '../../hooks/useDashboardTransactions'
import { PolicyEditorDrawer } from './controls/PolicyEditorDrawer'
import {
  formatTokenAmount,
  formatUsd,
  selectActivityRows,
  selectControlRows,
  selectWalletRows,
} from './data/selectors'

const statusStyles = {
  active: 'bg-lime/15 text-lime',
  executed: 'bg-lime/15 text-lime',
  pending: 'bg-pending/15 text-pending',
  blocked: 'bg-blocked/15 text-blocked',
}
const typeIcons = {
  Swap: ArrowLeftRight,
  Transfer: Send,
  Payment: Coins,
  Wallet: KeyRound,
  Agent: Zap,
  Deposit: ArrowDownToLine,
  Liquidity: Droplets,
  Action: ActivityIcon,
}

function CopyButton({ value }) {
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
          /* clipboard may be blocked */
        }
      }}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
      aria-label="Copy address"
    >
      {copied ? (
        <Check className="size-4 text-lime" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
    </button>
  )
}

export function WalletDetailPage() {
  const { agentId } = useParams()
  const { status, agents, error, refresh } = useAgentWallets()
  const [editing, setEditing] = useState(false)

  const snap = agents.find((a) => a?.agent?.agentId === agentId)
  const walletRow = selectWalletRows(agents).find((r) => r.agentId === agentId)
  const controlRow = selectControlRows(agents).find((r) => r.agentId === agentId)
  const { transactions } = useDashboardTransactions(50, agentId)
  const activity = selectActivityRows(transactions)

  if (status === 'loading') {
    return (
      <Shell title="Wallet">
        <div className="rounded-3xl bg-panel p-10 text-center text-sm text-muted-foreground">
          Loading wallet…
        </div>
      </Shell>
    )
  }

  if (status === 'error' && !snap) {
    return (
      <Shell title="Wallet">
        <div className="rounded-3xl bg-panel p-10 text-center text-sm text-blocked">
          {error || 'Unable to load wallet.'}
        </div>
      </Shell>
    )
  }

  if (!snap) {
    return (
      <Shell title="Wallet">
        <div className="flex flex-col items-start gap-4 rounded-3xl bg-panel p-10">
          <p className="text-sm text-muted-foreground">
            This agent wallet could not be found.
          </p>
          <Link
            to="/dashboard/wallets"
            className="inline-flex items-center gap-2 rounded-full bg-panel-2 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-panel-2/70"
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> Back to Wallets
          </Link>
        </div>
      </Shell>
    )
  }

  const agent = snap.agent
  const address = snap.portfolio?.address || ''
  const positions = (snap.portfolio?.positions ?? []).filter(
    (p) => Number(p.quantity) > 0 || Number(p.value) > 0,
  )

  return (
    <Shell title={agent.displayName || 'Wallet'}>
      <Link
        to="/dashboard/wallets"
        className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Wallets
      </Link>

      {/* Identity + value */}
      <section className="rounded-3xl bg-panel p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-lime text-primary-foreground">
              <Bot className="size-7" strokeWidth={2} aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  {agent.displayName}
                </h2>
                {walletRow ? (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${statusStyles[walletRow.tone] ?? statusStyles.pending}`}
                  >
                    <span className="size-1.5 rounded-full bg-current" />
                    {walletRow.label}
                  </span>
                ) : null}
              </div>
              {address ? (
                <div className="flex items-center gap-1.5">
                  <span className="break-all font-mono text-xs text-muted-foreground">
                    {address}
                  </span>
                  <CopyButton value={address} />
                </div>
              ) : null}
              <span className="font-mono text-xs text-muted-foreground">
                {agent.settlementMode === 'ows' ? 'OWS self-custody' : agent.settlementMode}
                {agent.firstConnectedAt ? ' · online' : ' · not yet connected'}
              </span>
            </div>
          </div>
          <div className="flex flex-col lg:items-end">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Portfolio value
            </span>
            <span className="font-mono text-4xl font-semibold tracking-tight text-foreground">
              {walletRow?.value ?? formatUsd(0)}
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Holdings */}
        <section className="rounded-3xl bg-panel p-6">
          <h3 className="text-lg font-semibold tracking-tight text-foreground">Holdings</h3>
          <div className="mt-4 flex flex-col">
            {positions.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                No on-chain balances yet. Fund this wallet to see holdings.
              </p>
            ) : (
              positions.map((p, i) => (
                <div
                  key={`${p.symbol}-${i}`}
                  className={`flex items-center justify-between py-3 ${i !== 0 ? 'border-t border-hairline' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-panel-2 font-mono text-xs font-semibold text-foreground">
                      {String(p.symbol ?? '?').slice(0, 4)}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-foreground">{p.symbol}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatTokenAmount(p.quantity)} {p.symbol}
                      </span>
                    </div>
                  </div>
                  <span className="font-mono text-sm text-foreground">
                    {p.value != null ? formatUsd(p.value) : '—'}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Rails */}
        <section className="rounded-3xl bg-panel p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">Rails</h3>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-panel-2/70"
            >
              <Pencil className="size-3.5" strokeWidth={2} aria-hidden="true" /> Edit
            </button>
          </div>
          <dl className="mt-4 flex flex-col">
            {[
              ['Per-transaction limit', controlRow?.perTx ?? '—'],
              ['Approval threshold', controlRow?.approval ?? '—'],
              [
                'Allowed',
                (controlRow?.allowed ?? []).join(' · ') || '—',
              ],
              ['Privacy', controlRow?.privacy ? 'Private' : 'Off'],
            ].map(([label, value], i) => (
              <div
                key={label}
                className={`flex items-center justify-between gap-4 py-3 ${i !== 0 ? 'border-t border-hairline' : ''}`}
              >
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="text-right font-mono text-sm text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* Activity */}
      <section className="rounded-3xl bg-panel p-6">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">Activity</h3>
        <div className="mt-4 flex flex-col">
          {activity.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No activity for this wallet yet.</p>
          ) : (
            activity.map((it, i) => {
              const Icon = it.tone === 'blocked' ? ShieldAlert : (typeIcons[it.type] ?? ActivityIcon)
              return (
                <div
                  key={it.id ?? `${it.title}-${i}`}
                  className={`flex items-center gap-4 py-4 ${i !== 0 ? 'border-t border-hairline' : ''}`}
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-panel-2 text-foreground">
                    <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-foreground">{it.title}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{it.sub}</span>
                  </div>
                  <span className="hidden shrink-0 font-mono text-sm text-foreground sm:block">{it.amount}</span>
                  <span
                    className={`hidden shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium sm:inline-flex ${statusStyles[it.tone] ?? statusStyles.pending}`}
                  >
                    <span className="size-1.5 rounded-full bg-current" />
                    {it.status}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{it.time}</span>
                    {it.txUrl && (
                      <a
                        href={it.txUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="View on Solscan"
                        className="text-muted-foreground transition-colors hover:text-lime"
                      >
                        <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {editing ? (
        <PolicyEditorDrawer
          agent={agent}
          onClose={() => setEditing(false)}
          onSaved={() => refresh?.()}
        />
      ) : null}
    </Shell>
  )
}
