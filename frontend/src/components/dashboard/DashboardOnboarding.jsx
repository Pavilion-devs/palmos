import { ArrowRight, KeyRound, RotateCcw } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_DASHBOARD_API_BASE_URL || ''

const INITIAL_TURN = {
  field: 'agentTask',
  message:
    'Hi there, welcome to PalmOS. I am here to manage your agent wallet. What should this agent do for you?',
  inputType: 'text',
  placeholder: 'Generate market-ops briefs using paid PUSD APIs',
  state: {
    agentName: 'PalmOS Agent',
  },
  complete: false,
}

function displayUserReply(turn, value) {
  if (turn.inputType === 'secret') {
    return value.trim() ? 'Added as a masked secret.' : 'Skipped.'
  }

  if (!value.trim()) {
    return 'Skipped.'
  }

  if (turn.suffix && !value.trim().toLowerCase().endsWith(turn.suffix.toLowerCase())) {
    return `${value.trim()} ${turn.suffix}`
  }

  const choice = turn.choices?.find((item) => item.value === value)
  return choice?.label ?? value.trim()
}

function buildStoredSetup(state) {
  return {
    agentName: state.agentName || 'PalmOS Agent',
    agentTask: state.agentTask || 'Generate market-ops briefs using paid PUSD APIs',
    maxPerCall: state.maxPerCall || '0.05',
    sessionBudget: state.sessionBudget || '1.00',
    autoApproveUnder: state.autoApproveUnder || '0.05',
    allowedVendors: Array.isArray(state.allowedVendors)
      ? state.allowedVendors
      : ['local.palmos.ops', 'local.palmos.spot_price'],
    managerAddress: state.managerAddress || '',
    walletMode: state.walletMode || 'local-demo',
    hasAnthropicKey: Boolean(state.hasAnthropicKey),
    hasWalletSecret: Boolean(state.hasWalletSecret),
    completedAt: new Date().toISOString(),
  }
}

function buildApiUrl(path) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

async function requestNextTurn(turn, value) {
  const response = await fetch(buildApiUrl('/api/dashboard/onboarding/turn'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      field: turn.field,
      userReply: turn.inputType === 'secret' ? (value ? '[masked secret]' : '') : value,
      state: turn.state,
    }),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload?.message || !payload?.field) {
    throw new Error(payload?.message || 'PalmOS could not continue setup.')
  }

  return payload
}

async function createDashboardAgent(setup) {
  const response = await fetch(buildApiUrl('/api/dashboard/agents'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      setup,
    }),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload?.ok || !payload?.agent?.agentId) {
    throw new Error(payload?.error || 'PalmOS could not create this agent.')
  }

  return payload
}

export default function DashboardOnboarding({ onComplete }) {
  const [turn, setTurn] = useState(INITIAL_TURN)
  const [messages, setMessages] = useState([
    {
      id: 'hello',
      role: 'assistant',
      text: INITIAL_TURN.message,
    },
  ])
  const [draft, setDraft] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const canSend = useMemo(() => {
    return turn.optional || draft.trim().length > 0
  }, [draft, turn.optional])

  const appendUserMessage = (value) => {
    setMessages((current) => [
      ...current,
      {
        id: `${turn.field}:user:${current.length}`,
        role: 'user',
        text: displayUserReply(turn, value),
      },
    ])
  }

  const submitValue = async (value) => {
    if (isThinking || (!turn.optional && !value.trim())) {
      return
    }

    setError('')
    appendUserMessage(value)
    setDraft('')
    setIsThinking(true)

    try {
      const nextTurn = await requestNextTurn(turn, value.trim())
      setTurn(nextTurn)
      setMessages((current) => [
        ...current,
        {
          id: `${nextTurn.field}:assistant:${current.length}`,
          role: 'assistant',
          text: nextTurn.message,
          error: Boolean(nextTurn.validationError),
        },
      ])
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'PalmOS could not continue setup.'
      setError(message)
      setMessages((current) => [
        ...current,
        {
          id: `error:${current.length}`,
          role: 'assistant',
          text: message,
          error: true,
        },
      ])
    } finally {
      setIsThinking(false)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const submitDraft = (event) => {
    event.preventDefault()

    if (!canSend) {
      return
    }

    void submitValue(draft)
  }

  const completeSetup = async () => {
    if (isThinking) {
      return
    }

    const sanitized = buildStoredSetup(turn.state || {})
    setError('')
    setIsThinking(true)

    try {
      const created = await createDashboardAgent(sanitized)
      window.localStorage.setItem('palmos.dashboard.setup', JSON.stringify(sanitized))
      window.localStorage.setItem('palmos.dashboard.selectedAgentId', created.agent.agentId)
      if (created.token) {
        window.localStorage.setItem('palmos.dashboard.agentToken', created.token)
      }
      onComplete({
        ...sanitized,
        agentId: created.agent.agentId,
      })
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'PalmOS could not create this agent.'
      setError(message)
      setMessages((current) => [
        ...current,
        {
          id: `create-agent-error:${current.length}`,
          role: 'assistant',
          text: message,
          error: true,
        },
      ])
    } finally {
      setIsThinking(false)
    }
  }

  const restart = () => {
    window.localStorage.removeItem('palmos.dashboard.setup')
    setTurn(INITIAL_TURN)
    setDraft('')
    setError('')
    setMessages([
      {
        id: 'hello',
        role: 'assistant',
        text: INITIAL_TURN.message,
      },
    ])
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-5 py-8 text-white">
      <div className="flex min-h-[72vh] w-full max-w-2xl flex-col justify-end">
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[82%] whitespace-pre-wrap text-base leading-7 md:text-lg ${
                  message.role === 'user'
                    ? 'border border-neutral-800 px-4 py-3 text-neutral-200'
                    : message.error
                      ? 'text-yellow-300'
                      : 'text-white'
                }`}
              >
                {message.text}
              </div>
            </div>
          ))}

          {isThinking && (
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-700">
              PalmOS is thinking
            </div>
          )}

          {turn.inputType === 'choice' && !turn.complete && !isThinking && (
            <div className="flex flex-wrap gap-2 pt-2">
              {turn.choices?.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  onClick={() => {
                    void submitValue(choice.value)
                  }}
                  className="border border-neutral-800 px-4 py-3 text-xs uppercase tracking-widest text-neutral-300 transition-colors hover:border-white hover:text-white"
                >
                  {choice.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {turn.complete && (
          <div className="mt-8 flex items-center justify-between border-t border-neutral-900 pt-5">
            <button
              type="button"
              onClick={restart}
              className="flex items-center gap-2 text-xs uppercase tracking-widest text-neutral-600 transition-colors hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Start over
            </button>
            <button
              type="button"
              onClick={completeSetup}
              className="flex items-center gap-2 border border-white px-5 py-3 text-xs uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black"
            >
              Open console
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {!turn.complete && turn.inputType !== 'choice' && (
          <form onSubmit={submitDraft} className="mt-8 border-t border-neutral-900 pt-5">
            <div className="flex items-center gap-3">
              <div
                className={`flex min-w-0 flex-1 items-center border ${
                  error ? 'border-yellow-500/60' : 'border-neutral-800'
                } focus-within:border-white`}
              >
                {turn.inputType === 'secret' && (
                  <KeyRound className="ml-3 h-4 w-4 shrink-0 text-neutral-600" />
                )}
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(event) => {
                    setError('')
                    setDraft(event.target.value)
                  }}
                  type={turn.inputType === 'secret' ? 'password' : 'text'}
                  inputMode={turn.inputType === 'amount' ? 'decimal' : 'text'}
                  autoComplete="off"
                  placeholder={turn.placeholder}
                  className="min-w-0 flex-1 bg-black px-4 py-4 text-sm text-white outline-none placeholder:text-neutral-700"
                />
                {turn.suffix && (
                  <span className="border-l border-neutral-800 px-3 py-4 font-mono text-xs text-neutral-500">
                    {turn.suffix}
                  </span>
                )}
              </div>
              {turn.optional && (
                <button
                  type="button"
                  onClick={() => {
                    void submitValue('')
                  }}
                  className="px-2 py-3 text-xs uppercase tracking-widest text-neutral-600 transition-colors hover:text-white"
                >
                  Skip
                </button>
              )}
              <button
                type="submit"
                disabled={!canSend || isThinking}
                className={`border px-4 py-4 text-xs uppercase tracking-widest transition-colors ${
                  canSend && !isThinking
                    ? 'border-neutral-700 text-white hover:bg-white hover:text-black'
                    : 'cursor-not-allowed border-neutral-900 text-neutral-700'
                }`}
              >
                Send
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
