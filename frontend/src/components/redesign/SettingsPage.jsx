import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Shell } from './Shell'
import { useOperatorSession } from '../../hooks/useOperatorSession'
import { useWorkspace } from '../../hooks/useWorkspace'
import { fetchDashboardApi } from '../../useDashboardStore'
import { truncateAddress } from './data/selectors'

function Row({ label, sub, children, last }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-4 ${last ? '' : 'border-b border-hairline'}`}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {sub ? <div className="mt-1 font-mono text-xs text-muted-foreground">{sub}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Input({ value, readOnly = true, ...props }) {
  return (
    <input
      readOnly={readOnly}
      value={value}
      className="min-w-[220px] rounded-xl border border-hairline bg-panel-2 px-4 py-2.5 text-sm text-foreground outline-none focus:border-lime/40"
      {...props}
    />
  )
}

function Pill({ children }) {
  return <span className="rounded-full bg-lime/15 px-3 py-1.5 text-xs font-medium text-lime">{children}</span>
}

function Toggle({ on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-lime' : 'bg-hairline'}`}
    >
      <span className={`absolute top-1 size-4 rounded-full bg-white transition-all ${on ? 'left-6' : 'left-1'}`} />
    </button>
  )
}

function OperatorProfile() {
  const { operator, refresh } = useOperatorSession()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Sync the form when the operator loads / changes.
  useEffect(() => {
    setName(operator?.displayName ?? '')
    setEmail(operator?.email ?? '')
  }, [operator?.displayName, operator?.email])

  const dirty =
    name.trim() !== (operator?.displayName ?? '') ||
    email.trim() !== (operator?.email ?? '')

  async function save() {
    if (!operator?.operatorId) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      // Self-service profile endpoint — any role may edit their own name/email
      // (the owner-only /operators/:id route is for managing other operators).
      const response = await fetchDashboardApi('/api/dashboard/session/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name.trim(), email: email.trim() }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || 'Could not save profile.')
      }
      await refresh()
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-3xl bg-panel p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Operator profile</h2>
        {saved && !dirty && (
          <span className="inline-flex items-center gap-1 text-xs text-lime">
            <Check className="size-3.5" aria-hidden="true" /> Saved
          </span>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-blocked/30 bg-blocked/10 px-3 py-2 text-xs text-blocked">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-col">
        <Row label="Display name" sub="Shown on the dashboard">
          <Input
            value={name}
            readOnly={false}
            onChange={(e) => {
              setName(e.target.value)
              setSaved(false)
            }}
          />
        </Row>
        <Row label="Email" sub="Optional · for alerts and recovery">
          <Input
            value={email}
            readOnly={false}
            type="email"
            placeholder="you@example.com"
            onChange={(e) => {
              setEmail(e.target.value)
              setSaved(false)
            }}
          />
        </Row>
        <Row label="Role" sub="Owners can mutate + manage operators">
          <Pill>{operator?.role ?? '—'}</Pill>
        </Row>
        <Row label="Wallet" sub="Your Sign-In With Solana identity" last>
          <span className="font-mono text-sm text-foreground">
            {operator?.walletAddress ? truncateAddress(operator.walletAddress) : '—'}
          </span>
        </Row>
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </section>
  )
}

function WorkspaceSettings() {
  const { workspace, refresh } = useWorkspace()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  // Sync the form once the workspace record loads.
  useEffect(() => {
    setName(workspace?.displayName ?? '')
  }, [workspace?.displayName])

  const workspaceId = workspace?.workspaceId ?? '—'
  const dirty =
    name.trim().length > 0 && name.trim() !== (workspace?.displayName ?? '')

  async function save() {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const response = await fetchDashboardApi('/api/dashboard/workspace', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name.trim() }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || payload?.error || 'Could not save workspace.')
      }
      await refresh()
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save workspace.')
    } finally {
      setSaving(false)
    }
  }

  async function copyId() {
    if (!workspace?.workspaceId) return
    try {
      await navigator.clipboard?.writeText(workspace.workspaceId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <section className="rounded-3xl bg-panel p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Workspace</h2>
        {saved && !dirty && (
          <span className="inline-flex items-center gap-1 text-xs text-lime">
            <Check className="size-3.5" aria-hidden="true" /> Saved
          </span>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-blocked/30 bg-blocked/10 px-3 py-2 text-xs text-blocked">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-col">
        <Row label="Workspace name" sub="Shown across the dashboard">
          <Input
            value={name}
            readOnly={false}
            placeholder="My workspace"
            onChange={(e) => {
              setName(e.target.value)
              setSaved(false)
            }}
          />
        </Row>
        <Row label="Workspace ID" sub={workspaceId}>
          <button
            type="button"
            onClick={copyId}
            className="inline-flex items-center gap-2 rounded-full border border-hairline px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-panel-2"
          >
            {copied ? (
              <Check className="size-3.5 text-lime" strokeWidth={2} aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" strokeWidth={2} aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </Row>
        <Row label="Network" sub="Solana cluster for reads & settlement" last><NetworkToggle /></Row>
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </section>
  )
}

function NetworkToggle() {
  const [network, setNetwork] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchDashboardApi('/api/dashboard/network')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.network) setNetwork(d.network)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function choose(next) {
    if (busy || next === network) return
    setBusy(true)
    try {
      const response = await fetchDashboardApi('/api/dashboard/network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ network: next }),
      })
      const payload = await response.json().catch(() => null)
      if (response.ok && payload?.network) setNetwork(payload.network)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-1 rounded-full bg-panel-2 p-1">
      {['mainnet', 'devnet'].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => choose(n)}
          disabled={busy}
          className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors disabled:opacity-60 ${
            network === n ? 'bg-lime text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

export function SettingsPage() {
  const [driver, setDriver] = useState('File')
  const [snapshots, setSnapshots] = useState(true)

  return (
    <Shell title="Settings">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Workspace */}
        <WorkspaceSettings />

        {/* Operator profile */}
        <OperatorProfile />

        {/* Storage */}
        <section className="rounded-3xl bg-panel p-6">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Storage</h2>
          <div className="mt-4 flex flex-col">
            <Row label="Driver" sub="File default · Postgres opt-in">
              <div className="flex items-center gap-1 rounded-full bg-panel-2 p-1">
                {['File', 'Postgres'].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDriver(d)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                      driver === d ? 'bg-lime text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Portfolio snapshots" sub="Capture history hourly" last>
              <Toggle on={snapshots} onClick={() => setSnapshots((s) => !s)} />
            </Row>
          </div>
        </section>

        {/* Danger zone */}
        <section className="rounded-3xl border border-blocked/30 bg-panel p-6">
          <h2 className="text-xl font-semibold tracking-tight text-blocked">Danger zone</h2>
          <div className="mt-4 flex flex-col">
            <Row label="Reset workspace" sub="Clears all agents, actions & history" last>
              <button type="button" className="rounded-full border border-blocked/40 px-4 py-2 text-sm font-medium text-blocked transition-colors hover:bg-blocked/10">
                Reset…
              </button>
            </Row>
          </div>
        </section>
      </div>
    </Shell>
  )
}
