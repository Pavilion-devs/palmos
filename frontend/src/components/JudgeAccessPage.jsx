import { ArrowRight, ShieldCheck } from 'lucide-react'
import { useRef, useState } from 'react'
import { navigate } from '../hooks/useHashRoute'

const API_BASE_URL = import.meta.env.VITE_DASHBOARD_API_BASE_URL || ''

function buildApiUrl(path) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

export default function JudgeAccessPage() {
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const inputRef = useRef(null)

  async function requestAccess(path, body) {
    const response = await fetch(buildApiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok || payload?.ok === false || !payload?.expiresAt) {
      return null
    }

    return payload
  }

  async function submit(event) {
    event.preventDefault()
    setError('')

    if (!passcode.trim()) {
      setError('Enter the access code from the submission notes.')
      inputRef.current?.focus()
      return
    }

    setPending(true)
    try {
      const trimmedPasscode = passcode.trim()
      const payload =
        (await requestAccess('/api/dashboard/operator-login', {
          password: trimmedPasscode,
        })) ??
        (await requestAccess('/api/dashboard/judge-access', {
          passcode: trimmedPasscode,
        }))

      if (!payload) {
        throw new Error('Invalid access code. Check the code from the submission notes.')
      }

      window.sessionStorage.setItem('palmos_dashboard_access', String(payload.expiresAt))
      window.sessionStorage.setItem('palmos_judge_access', String(payload.expiresAt))
      navigate('#dashboard')
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Invalid access code. Check the code from the submission notes.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-5 py-8 text-white">
      <div className="w-full max-w-md border border-neutral-800 bg-neutral-950">
        <div className="border-b border-neutral-900 px-5 py-5">
          <div className="mb-4 flex h-11 w-11 items-center justify-center border border-neutral-700 bg-black">
            <ShieldCheck className="h-5 w-5 text-neutral-300" aria-hidden="true" />
          </div>
          <div className="text-[10px] uppercase tracking-[0.24em] text-neutral-600">
            Private demo
          </div>
          <h1 className="mt-2 text-2xl font-medium">Judge Demo Access</h1>
          <p className="mt-2 text-sm leading-6 text-neutral-500">
            Private PalmOS demo environment for hackathon review.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 p-5">
          {error && (
            <div className="border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="judge-passcode" className="text-[10px] uppercase tracking-widest text-neutral-500">
              Passcode
            </label>
            <input
              ref={inputRef}
              id="judge-passcode"
              type="password"
              autoComplete="current-password"
              value={passcode}
              onChange={(event) => {
                setPasscode(event.target.value)
                setError('')
              }}
              aria-invalid={error ? 'true' : undefined}
              className="mt-1 min-h-10 w-full border border-neutral-800 bg-black px-3 text-sm text-white focus:border-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="group flex min-h-10 w-full items-center justify-center gap-2 border border-white bg-white px-4 text-xs uppercase tracking-widest text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? 'Checking...' : 'Enter demo'}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  )
}
