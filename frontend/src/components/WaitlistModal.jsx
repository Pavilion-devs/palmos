import { CheckCircle2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const FORMSPREE_WAITLIST_ENDPOINT =
  import.meta.env.VITE_FORMSPREE_WAITLIST_ENDPOINT ||
  'https://formspree.io/f/xbdwzpao'

const INITIAL_FORM = {
  name: '',
  email: '',
  roleCompany: '',
  agentUseCase: '',
}

function validate(form) {
  const errors = {}
  if (!form.name.trim()) errors.name = 'Name is required.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Enter a valid email.'
  }
  if (!form.roleCompany.trim()) errors.roleCompany = 'Role or company is required.'
  if (!form.agentUseCase.trim()) {
    errors.agentUseCase = 'Tell us what type of agent you want to connect.'
  }
  return errors
}

function Field({ id, label, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="text-[10px] uppercase tracking-widest text-neutral-500">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-[11px] text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}

export default function WaitlistModal({ open, onClose }) {
  const [form, setForm] = useState(INITIAL_FORM)
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [pending, setPending] = useState(false)
  const [complete, setComplete] = useState(false)
  const firstFieldRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.setTimeout(() => firstFieldRef.current?.focus(), 0)

    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, open])

  if (!open) return null

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setServerError('')
  }

  async function submit(event) {
    event.preventDefault()
    const nextErrors = validate(form)
    setErrors(nextErrors)
    setServerError('')
    if (Object.values(nextErrors).some(Boolean)) return

    setPending(true)
    try {
      const response = await fetch(FORMSPREE_WAITLIST_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          role_company: form.roleCompany.trim(),
          agent_use_case: form.agentUseCase.trim(),
          _subject: 'New PalmOS waitlist signup',
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const formspreeError = payload?.errors?.[0]?.message
        throw new Error(formspreeError || 'Unable to join the waitlist.')
      }
      setComplete(true)
      setForm(INITIAL_FORM)
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Unable to join the waitlist.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="waitlist-title"
    >
      <div className="w-full max-w-lg border border-neutral-800 bg-black text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-900 px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.24em] text-neutral-600">
              PalmOS private access
            </div>
            <h2 id="waitlist-title" className="mt-1 text-xl font-medium">
              Join the waitlist
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 min-w-10 items-center justify-center text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            aria-label="Close waitlist form"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {complete ? (
          <div className="p-5">
            <div className="flex items-start gap-3 border border-green-500/30 bg-green-500/5 px-4 py-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-400" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-medium text-green-200">
                  You're on the PalmOS waitlist.
                </h3>
                <p className="mt-1 text-sm leading-6 text-green-200/80">
                  We'll reach out when access opens.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 min-h-10 w-full border border-white bg-white px-4 text-xs uppercase tracking-widest text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-5">
            {serverError && (
              <div className="border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
                {serverError}
              </div>
            )}

            <Field id="waitlist-name" label="Name" error={errors.name}>
              <input
                ref={firstFieldRef}
                id="waitlist-name"
                type="text"
                autoComplete="name"
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                aria-invalid={errors.name ? 'true' : undefined}
                aria-describedby={errors.name ? 'waitlist-name-error' : undefined}
                className="min-h-10 w-full border border-neutral-800 bg-neutral-950 px-3 text-sm text-white focus:border-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
              />
            </Field>

            <Field id="waitlist-email" label="Email" error={errors.email}>
              <input
                id="waitlist-email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                value={form.email}
                onChange={(event) => updateField('email', event.target.value)}
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'waitlist-email-error' : undefined}
                className="min-h-10 w-full border border-neutral-800 bg-neutral-950 px-3 text-sm text-white focus:border-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
              />
            </Field>

            <Field id="waitlist-role-company" label="Role / company" error={errors.roleCompany}>
              <input
                id="waitlist-role-company"
                type="text"
                autoComplete="organization-title"
                value={form.roleCompany}
                onChange={(event) => updateField('roleCompany', event.target.value)}
                aria-invalid={errors.roleCompany ? 'true' : undefined}
                aria-describedby={errors.roleCompany ? 'waitlist-role-company-error' : undefined}
                className="min-h-10 w-full border border-neutral-800 bg-neutral-950 px-3 text-sm text-white focus:border-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
              />
            </Field>

            <Field
              id="waitlist-agent-use-case"
              label="What type of agent do you want to connect?"
              error={errors.agentUseCase}
            >
              <textarea
                id="waitlist-agent-use-case"
                rows={4}
                value={form.agentUseCase}
                onChange={(event) => updateField('agentUseCase', event.target.value)}
                aria-invalid={errors.agentUseCase ? 'true' : undefined}
                aria-describedby={errors.agentUseCase ? 'waitlist-agent-use-case-error' : undefined}
                className="w-full resize-none border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm leading-6 text-white focus:border-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
              />
            </Field>

            <button
              type="submit"
              disabled={pending}
              aria-busy={pending}
              className="min-h-10 w-full border border-white bg-white px-4 text-xs uppercase tracking-widest text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? 'Joining...' : 'Join waitlist'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
