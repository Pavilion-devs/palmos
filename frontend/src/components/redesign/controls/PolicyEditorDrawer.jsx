import { useEffect, useState } from 'react'
import { X, Loader2, ShieldCheck } from 'lucide-react'
import { useAgentPolicyUpdate } from '../../../hooks/useAgentPolicyUpdate'

const PRIVACY_OPTIONS = [
  { value: 'disabled', label: 'Off' },
  { value: 'allowed', label: 'Optional' },
  { value: 'required', label: 'Required' },
]

function privacyOf(agent) {
  return agent?.privacyMode ?? agent?.policyConfig?.privacyMode ?? 'disabled'
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

// Right-side drawer to edit an agent's governed rails (limits + approval
// threshold + privacy). Allowed assets/chains are shown read-only — they're set
// at creation and not editable through the current API.
export function PolicyEditorDrawer({ agent, onClose, onSaved }) {
  const pc = agent?.policyConfig ?? {}
  const asset = pc.allowedAssets?.[0] ?? 'PUSD'
  const [maxPerTx, setMaxPerTx] = useState(pc.maxPerTransaction ?? '')
  const [approvalOver, setApprovalOver] = useState(pc.autoApproveUnder ?? '')
  const [sessionBudget, setSessionBudget] = useState(pc.sessionBudget ?? '')
  const [privacy, setPrivacy] = useState(privacyOf(agent))
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

          <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-hairline bg-background p-4">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Allowed assets &amp; chains
            </span>
            <div className="flex flex-wrap gap-2">
              {[...(pc.allowedChains ?? []), ...(pc.allowedAssets ?? [])].map(
                (item) => (
                  <span
                    key={item}
                    className="inline-flex rounded-full border border-hairline bg-panel-2 px-2.5 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {item}
                  </span>
                ),
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              Set at creation — not editable yet.
            </span>
          </div>
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
