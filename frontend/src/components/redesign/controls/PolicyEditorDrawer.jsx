import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, ShieldCheck, Plus, AlertTriangle } from 'lucide-react'
import { useAgentPolicyUpdate } from '../../../hooks/useAgentPolicyUpdate'

const PRIVACY_OPTIONS = [
  { value: 'disabled', label: 'Off' },
  { value: 'allowed', label: 'Optional' },
  { value: 'required', label: 'Required' },
]

// Base58, 32–44 chars — a cheap client-side check so we don't add obviously
// broken addresses. The backend does the real PublicKey validation.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function privacyOf(agent) {
  return agent?.privacyMode ?? agent?.policyConfig?.privacyMode ?? 'disabled'
}

// The transfer rails the operator can see/edit, resolved the same way the
// backend resolves them: the dedicated transferPolicy override wins, otherwise
// fall back to the vendor-derived recipients / top-level assets+chains.
function resolveRails(pc) {
  const tp = pc.transferPolicy ?? {}
  const recipients =
    tp.allowedRecipients ??
    (pc.allowedVendors ?? []).map((vendor) => ({
      counterpartyId: vendor.vendorId,
      label: vendor.label,
      destinationAddress: vendor.destinationAddress,
      chainId: vendor.chainId,
    }))
  return {
    recipients: recipients ?? [],
    assets: tp.allowedAssets ?? pc.allowedAssets ?? [],
    chains: tp.allowedChains ?? pc.allowedChains ?? [],
  }
}

function truncate(address) {
  if (!address || address.length <= 12) return address
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

function AmountInput({ value, onChange, unit }) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-hairline bg-background px-3 focus-within:border-lime/50">
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-transparent py-2.5 font-mono text-sm text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{unit}</span>
    </div>
  )
}

function RemovableChip({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-panel-2 py-1 pl-2.5 pr-1.5 text-xs font-medium text-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-blocked/15 hover:text-blocked"
        aria-label={`Remove ${label}`}
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  )
}

function Warning({ children }) {
  return (
    <span className="inline-flex items-start gap-1.5 text-xs text-pending">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </span>
  )
}

// Chip-list editor for a simple string allowlist (assets or chains).
function ListEditor({ label, hint, items, onChange, placeholder, normalize, emptyWarning }) {
  const [draft, setDraft] = useState('')

  function add() {
    const value = normalize(draft.trim())
    if (!value || items.includes(value)) {
      setDraft('')
      return
    }
    onChange([...items, value])
    setDraft('')
  }

  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-hairline bg-background p-3">
        {items.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <RemovableChip
                key={item}
                label={item}
                onRemove={() => onChange(items.filter((entry) => entry !== item))}
              />
            ))}
          </div>
        ) : (
          <Warning>{emptyWarning}</Warning>
        )}
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                add()
              }
            }}
            placeholder={placeholder}
            className="w-full rounded-[var(--radius-sm)] border border-hairline bg-panel px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-lime/50"
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-hairline px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-lime/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add
          </button>
        </div>
      </div>
    </Field>
  )
}

// The keystone: add/remove the destinations this agent is allowed to send to.
function DestinationsEditor({ recipients, chains, onChange }) {
  const chainOptions = chains.length > 0 ? chains : ['solana-devnet', 'solana-mainnet']
  const [address, setAddress] = useState('')
  const [recipientLabel, setRecipientLabel] = useState('')
  const [chainId, setChainId] = useState(chainOptions[0])

  const trimmedAddress = address.trim()
  const looksValid = SOLANA_ADDRESS_RE.test(trimmedAddress)
  const duplicate = recipients.some(
    (recipient) =>
      recipient.destinationAddress === trimmedAddress &&
      recipient.chainId === chainId,
  )

  function add() {
    if (!looksValid || duplicate) return
    const label = recipientLabel.trim() || undefined
    onChange([
      ...recipients,
      {
        counterpartyId: `addr_${trimmedAddress.slice(0, 8).toLowerCase()}`,
        label,
        destinationAddress: trimmedAddress,
        chainId,
      },
    ])
    setAddress('')
    setRecipientLabel('')
  }

  return (
    <Field
      label="Allowed destinations"
      hint="The agent can only send to addresses on this list. Everything else is hard-blocked."
    >
      <div className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-hairline bg-background p-3">
        {recipients.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {recipients.map((recipient) => (
              <li
                key={`${recipient.chainId}:${recipient.destinationAddress}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] bg-panel-2 px-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {recipient.label || 'Destination'}
                  </span>
                  <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    <span title={recipient.destinationAddress}>
                      {truncate(recipient.destinationAddress)}
                    </span>
                    <span className="rounded-full bg-panel px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                      {recipient.chainId}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      recipients.filter(
                        (entry) =>
                          !(
                            entry.destinationAddress ===
                              recipient.destinationAddress &&
                            entry.chainId === recipient.chainId
                          ),
                      ),
                    )
                  }
                  className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-blocked/15 hover:text-blocked"
                  aria-label="Remove destination"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Warning>
            No destinations allowlisted — this agent can’t send to anyone until you
            add one.
          </Warning>
        )}

        <div className="flex flex-col gap-2 border-t border-hairline pt-3">
          <input
            value={recipientLabel}
            onChange={(event) => setRecipientLabel(event.target.value)}
            placeholder="Label (optional) — e.g. Treasury"
            className="w-full rounded-[var(--radius-sm)] border border-hairline bg-panel px-3 py-2 text-sm text-foreground outline-none focus:border-lime/50"
          />
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Destination address"
            spellCheck={false}
            className="w-full rounded-[var(--radius-sm)] border border-hairline bg-panel px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-lime/50"
          />
          <div className="flex items-center gap-2">
            <select
              value={chainId}
              onChange={(event) => setChainId(event.target.value)}
              className="rounded-[var(--radius-sm)] border border-hairline bg-panel px-3 py-2 text-sm text-foreground outline-none focus:border-lime/50"
            >
              {chainOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={add}
              disabled={!looksValid || duplicate}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-full border border-hairline px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-lime/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add destination
            </button>
          </div>
          {trimmedAddress && !looksValid ? (
            <Warning>That doesn’t look like a valid Solana address.</Warning>
          ) : null}
          {duplicate ? (
            <Warning>That destination is already allowlisted on this chain.</Warning>
          ) : null}
        </div>
      </div>
    </Field>
  )
}

// Right-side drawer to edit an agent's governed rails: limits, approval
// threshold, privacy, and the transfer allowlist (destinations / assets /
// chains). Limits and privacy are their own governed actions; the allowlist
// rides the same wallet.policy_update PATCH as the limits.
export function PolicyEditorDrawer({ agent, onClose, onSaved }) {
  const pc = useMemo(() => agent?.policyConfig ?? {}, [agent])
  const rails = useMemo(() => resolveRails(pc), [pc])
  const asset = rails.assets[0] ?? pc.allowedAssets?.[0] ?? 'PUSD'

  const [maxPerTx, setMaxPerTx] = useState(pc.maxPerTransaction ?? '')
  const [approvalOver, setApprovalOver] = useState(pc.autoApproveUnder ?? '')
  const [sessionBudget, setSessionBudget] = useState(pc.sessionBudget ?? '')
  const [privacy, setPrivacy] = useState(privacyOf(agent))
  const [recipients, setRecipients] = useState(rails.recipients)
  const [assets, setAssets] = useState(rails.assets)
  const [chains, setChains] = useState(rails.chains)
  const { save, saving, error } = useAgentPolicyUpdate()

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const nMax = Number(maxPerTx)
  const nApproval = Number(approvalOver)
  const nBudget = Number(sessionBudget)
  const validationError = !(nMax > 0)
    ? 'Per-transaction limit must be greater than 0.'
    : !(nApproval >= 0)
      ? 'Approval threshold must be 0 or more.'
      : nApproval > nMax
        ? 'Approval threshold can’t exceed the per-transaction limit.'
        : sessionBudget !== '' && nBudget > 0 && nBudget < nMax
          ? 'Session budget must be ≥ the per-transaction limit.'
          : ''

  function buildTransferPolicyPatch() {
    const current = {
      allowedRecipients: recipients.map((recipient) => ({
        counterpartyId: recipient.counterpartyId,
        label: recipient.label,
        destinationAddress: recipient.destinationAddress,
        chainId: recipient.chainId,
      })),
      allowedAssets: assets,
      allowedChains: chains,
    }
    const seed = {
      allowedRecipients: rails.recipients.map((recipient) => ({
        counterpartyId: recipient.counterpartyId,
        label: recipient.label,
        destinationAddress: recipient.destinationAddress,
        chainId: recipient.chainId,
      })),
      allowedAssets: rails.assets,
      allowedChains: rails.chains,
    }
    return JSON.stringify(current) === JSON.stringify(seed) ? null : current
  }

  async function handleSave() {
    if (validationError) return
    const policyPatch = {}
    if (String(maxPerTx) !== String(pc.maxPerTransaction ?? '')) {
      policyPatch.maxPerTransaction = String(maxPerTx)
    }
    if (String(approvalOver) !== String(pc.autoApproveUnder ?? '')) {
      policyPatch.autoApproveUnder = String(approvalOver)
    }
    if (String(sessionBudget) !== String(pc.sessionBudget ?? '')) {
      policyPatch.sessionBudget = String(sessionBudget)
    }
    const transferPolicy = buildTransferPolicyPatch()
    if (transferPolicy) {
      policyPatch.transferPolicy = transferPolicy
    }
    const privacyChanged = privacy !== privacyOf(agent)
    const ok = await save(agent.agentId, {
      policyPatch,
      privacyMode: privacyChanged ? privacy : null,
    })
    if (ok) {
      onSaved?.()
      onClose?.()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close editor"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex h-full w-full max-w-md flex-col border-l border-hairline bg-panel"
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline p-6">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Edit rails
            </span>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {agent?.displayName ?? 'Agent'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-panel-2 hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
          <Field
            label="Per-transaction limit"
            hint="The most this agent can move in a single action."
          >
            <AmountInput value={maxPerTx} onChange={setMaxPerTx} unit={asset} />
          </Field>

          <Field
            label="Approval threshold"
            hint="Actions above this amount need your approval; at or below auto-execute."
          >
            <AmountInput
              value={approvalOver}
              onChange={setApprovalOver}
              unit={asset}
            />
          </Field>

          <Field
            label="Session budget"
            hint="Total this agent can spend over its session."
          >
            <AmountInput
              value={sessionBudget}
              onChange={setSessionBudget}
              unit={asset}
            />
          </Field>

          <Field label="Privacy">
            <div className="flex items-center gap-1 rounded-full bg-panel-2 p-1">
              {PRIVACY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPrivacy(option.value)}
                  className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                    privacy === option.value
                      ? 'bg-lime text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          <DestinationsEditor
            recipients={recipients}
            chains={chains}
            onChange={setRecipients}
          />

          <ListEditor
            label="Allowed assets"
            hint="Symbols this agent may transfer (e.g. SOL, USDC, PUSD)."
            items={assets}
            onChange={setAssets}
            placeholder="Add asset symbol"
            normalize={(value) => value.toUpperCase()}
            emptyWarning="No assets allowed — this agent can’t transfer anything."
          />

          <ListEditor
            label="Allowed chains"
            hint="Networks this agent may transact on."
            items={chains}
            onChange={setChains}
            placeholder="Add chain id — e.g. solana-devnet"
            normalize={(value) => value}
            emptyWarning="No chains allowed — this agent can’t transact anywhere."
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-hairline p-6">
          {(validationError || error) && (
            <p className="text-sm text-blocked">{validationError || error}</p>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || Boolean(validationError)}
              className="inline-flex items-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              Save rails
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
