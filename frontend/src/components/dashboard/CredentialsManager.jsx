import { Check, Copy, Edit3, Plus, RefreshCcw, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

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

function formatDateTime(value) {
  if (!value) return 'never'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return 'unknown'
  return new Date(parsed).toLocaleString('en-US', {
    hour12: false,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusTone(status) {
  return status === 'revoked'
    ? 'border-red-500/30 bg-red-500/5 text-red-400'
    : 'border-green-500/30 bg-green-500/5 text-green-400'
}

function TokenReveal({ token, title, onDismiss }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const ok = await copyToClipboard(token)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <div className="mt-4 border border-yellow-500/30 bg-yellow-500/5 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-widest text-yellow-300">
          {title}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          aria-label="Dismiss token"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mb-3 text-xs leading-5 text-neutral-400">
        Copy this token now. PalmOS stores only its hash and cannot show it again.
      </p>
      <code className="block break-all border border-neutral-800 bg-black p-3 font-mono text-xs leading-5 text-yellow-200">
        {token}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className="mt-3 flex w-full items-center justify-center gap-2 border border-neutral-700 bg-neutral-900 px-3 py-2 text-[10px] font-medium uppercase tracking-widest text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
      >
        <Copy className="h-3 w-3" aria-hidden="true" />
        {copied ? 'Copied' : 'Copy token'}
      </button>
    </div>
  )
}

function CredentialRow({
  credential,
  revokingId,
  rotatingId,
  renamingId,
  onRename,
  onRotate,
  onRevoke,
  canRename,
  canRotate,
}) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(credential.label ?? '')
  const [error, setError] = useState('')
  const isRevoked = credential.status === 'revoked'
  const busy =
    revokingId === credential.credentialId ||
    rotatingId === credential.credentialId ||
    renamingId === credential.credentialId

  async function handleRename() {
    const nextLabel = label.trim()
    if (!nextLabel) {
      setError('Label is required.')
      return
    }
    setError('')
    await onRename(credential.credentialId, nextLabel)
    setEditing(false)
  }

  return (
    <li className="border border-neutral-900 bg-black p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {editing ? (
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="min-h-9 min-w-0 flex-1 border border-neutral-800 bg-neutral-950 px-2 font-mono text-xs text-white focus:border-white focus:outline-none"
                aria-label="Credential label"
              />
            ) : (
              <span className="truncate text-sm font-medium text-neutral-200">
                {credential.label}
              </span>
            )}
            <span
              className={`shrink-0 border px-2 py-0.5 text-[10px] uppercase tracking-widest ${statusTone(
                credential.status,
              )}`}
            >
              {credential.status}
            </span>
          </div>

          <div className="grid gap-2 text-[11px] text-neutral-500 sm:grid-cols-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-neutral-700">
                Prefix
              </div>
              <div className="mt-0.5 truncate font-mono text-neutral-300">
                {credential.keyPrefix}...
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-neutral-700">
                Created
              </div>
              <div className="mt-0.5 font-mono">{formatDateTime(credential.createdAt)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-neutral-700">
                Last used
              </div>
              <div className="mt-0.5 font-mono">{formatDateTime(credential.lastUsedAt)}</div>
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {editing ? (
            <>
              <button
                type="button"
                onClick={handleRename}
                disabled={busy}
                className="flex items-center gap-1 border border-green-500/30 bg-green-500/10 px-2 py-1.5 text-[10px] uppercase tracking-widest text-green-400 transition-colors hover:bg-green-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="h-3 w-3" aria-hidden="true" />
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setLabel(credential.label ?? '')
                  setEditing(false)
                  setError('')
                }}
                disabled={busy}
                className="flex items-center gap-1 border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[10px] uppercase tracking-widest text-neutral-300 transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                Cancel
              </button>
            </>
          ) : (
            canRename && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={busy}
                className="flex items-center gap-1 border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[10px] uppercase tracking-widest text-neutral-300 transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Edit3 className="h-3 w-3" aria-hidden="true" />
                Rename
              </button>
            )
          )}

          {!isRevoked && canRotate && (
            <button
              type="button"
              onClick={() => onRotate(credential)}
              disabled={busy}
              className="flex items-center gap-1 border border-yellow-500/20 bg-yellow-500/5 px-2 py-1.5 text-[10px] uppercase tracking-widest text-yellow-300 transition-colors hover:bg-yellow-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCcw className="h-3 w-3" aria-hidden="true" />
              {rotatingId === credential.credentialId ? 'Rotating' : 'Rotate'}
            </button>
          )}

          {!isRevoked && (
            <button
              type="button"
              onClick={() => onRevoke(credential.credentialId)}
              disabled={busy}
              className="flex items-center gap-1 border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-[10px] uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              {revokingId === credential.credentialId ? 'Revoking' : 'Revoke'}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

export default function CredentialsManager({
  agentId,
  listAgentCredentials,
  createAgentCredential,
  revokeAgentCredential,
  updateAgentCredential,
  rotateAgentCredential,
}) {
  const [credsState, setCredsState] = useState({
    status: 'idle',
    credentials: [],
    error: '',
  })
  const [latestToken, setLatestToken] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('Production SDK key')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [revokingId, setRevokingId] = useState(null)
  const [rotatingId, setRotatingId] = useState(null)
  const [renamingId, setRenamingId] = useState(null)

  async function refreshCredentials() {
    const credentials = await listAgentCredentials(agentId)
    setCredsState({ status: 'ok', credentials, error: '' })
    return credentials
  }

  useEffect(() => {
    let cancelled = false
    setCredsState({ status: 'idle', credentials: [], error: '' })
    setLatestToken(null)
    setCreateError('')
    setRevokingId(null)
    setRotatingId(null)
    setRenamingId(null)
    listAgentCredentials(agentId)
      .then((credentials) => {
        if (!cancelled) {
          setCredsState({ status: 'ok', credentials, error: '' })
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCredsState({
            status: 'error',
            credentials: [],
            error: err instanceof Error ? err.message : 'Unable to load credentials',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [agentId, listAgentCredentials])

  async function handleCreate() {
    const label = newLabel.trim()
    if (!label) {
      setCreateError('Label is required.')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      const result = await createAgentCredential(agentId, label)
      setLatestToken({
        token: result.token,
        title: 'New credential token',
        credentialId: result.credential.credentialId,
      })
      setNewLabel('Production SDK key')
      setCreateOpen(false)
      await refreshCredentials()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create credential')
    } finally {
      setCreating(false)
    }
  }

  async function handleRename(credentialId, label) {
    if (!updateAgentCredential) return
    setRenamingId(credentialId)
    try {
      await updateAgentCredential(credentialId, { label })
      await refreshCredentials()
    } catch (err) {
      setCredsState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Unable to rename credential',
      }))
      throw err
    } finally {
      setRenamingId(null)
    }
  }

  async function handleRotate(credential) {
    if (!rotateAgentCredential) return
    setRotatingId(credential.credentialId)
    try {
      const result = await rotateAgentCredential(
        credential.credentialId,
        `${credential.label} rotated`,
      )
      setLatestToken({
        token: result.token,
        title: 'Rotated credential token',
        credentialId: result.credential.credentialId,
      })
      await refreshCredentials()
    } catch (err) {
      setCredsState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Unable to rotate credential',
      }))
    } finally {
      setRotatingId(null)
    }
  }

  async function handleRevoke(credentialId) {
    setRevokingId(credentialId)
    try {
      await revokeAgentCredential(credentialId)
      await refreshCredentials()
      if (latestToken?.credentialId === credentialId) {
        setLatestToken(null)
      }
    } catch (err) {
      setCredsState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Unable to revoke credential',
      }))
    } finally {
      setRevokingId(null)
    }
  }

  const activeCount = credsState.credentials.filter(
    (credential) => credential.status === 'active',
  ).length
  const revokedCount = credsState.credentials.filter(
    (credential) => credential.status === 'revoked',
  ).length

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-[10px] uppercase tracking-widest text-neutral-600">
            SDK credentials
          </span>
          {credsState.status === 'ok' && (
            <div className="mt-1 font-mono text-[10px] text-neutral-600">
              {activeCount} active / {revokedCount} revoked
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen((value) => !value)}
          disabled={creating}
          className="flex items-center gap-1 border border-neutral-700 bg-neutral-900 px-2 py-1 text-[10px] uppercase tracking-widest text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          New key
        </button>
      </div>

      {createOpen && (
        <div className="mb-4 border border-neutral-900 bg-black p-3">
          <label
            htmlFor={`credential-label-${agentId}`}
            className="text-[10px] uppercase tracking-widest text-neutral-700"
          >
            Key label
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id={`credential-label-${agentId}`}
              type="text"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              className="min-h-10 min-w-0 flex-1 border border-neutral-800 bg-neutral-950 px-3 text-sm text-white placeholder:text-neutral-700 focus:border-white focus:outline-none"
              placeholder="Production SDK key"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="border border-white bg-white px-4 py-2 text-xs uppercase tracking-widest text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? 'Creating' : 'Create'}
            </button>
          </div>
          {createError && <p className="mt-2 text-xs text-red-400">{createError}</p>}
        </div>
      )}

      {credsState.status === 'idle' && (
        <p className="text-xs text-neutral-600">Loading credentials...</p>
      )}

      {credsState.status === 'error' && (
        <p className="text-xs text-red-400">{credsState.error}</p>
      )}

      {credsState.status === 'ok' && credsState.credentials.length === 0 && (
        <p className="text-xs text-neutral-500">
          No credentials yet. Create one to authenticate an external agent.
        </p>
      )}

      {credsState.status === 'ok' && credsState.credentials.length > 0 && (
        <ul className="space-y-2">
          {credsState.credentials.map((credential) => (
            <CredentialRow
              key={`${credential.credentialId}:${credential.label}`}
              credential={credential}
              revokingId={revokingId}
              rotatingId={rotatingId}
              renamingId={renamingId}
              onRename={handleRename}
              onRotate={handleRotate}
              onRevoke={handleRevoke}
              canRename={Boolean(updateAgentCredential)}
              canRotate={Boolean(rotateAgentCredential)}
            />
          ))}
        </ul>
      )}

      {latestToken && (
        <TokenReveal
          token={latestToken.token}
          title={latestToken.title}
          onDismiss={() => setLatestToken(null)}
        />
      )}
    </div>
  )
}
