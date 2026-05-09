import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

function FormField({ label, hint, children }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-widest text-neutral-600">{label}</span>
        {hint && <span className="text-[10px] text-neutral-700">{hint}</span>}
      </div>
      {children}
    </label>
  )
}

export default function RegisterServiceForm({ onSubmit, onClose }) {
  const [serviceId, setServiceId] = useState('')
  const [label, setLabel] = useState('')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [destinationAddress, setDestinationAddress] = useState('')
  const [expectedAmount, setExpectedAmount] = useState('0.01')
  const [method, setMethod] = useState('GET')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onSubmit({
        serviceId: serviceId.trim(),
        label: label.trim() || undefined,
        endpointUrl: endpointUrl.trim(),
        destinationAddress: destinationAddress.trim(),
        expectedAmount: expectedAmount.trim(),
        method,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to register service')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'w-full border border-neutral-800 bg-black px-3 py-2 text-sm text-white placeholder:text-neutral-700 focus:border-white focus:outline-none'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Register service"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-5"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default focus-visible:outline-none"
      />
      <div className="relative w-full max-w-md border border-neutral-800 bg-neutral-950 p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-neutral-600">
              Register service
            </div>
            <h2 className="mt-1 text-lg font-medium text-white">New paid PUSD service</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-neutral-800 bg-neutral-900 p-1.5 text-neutral-400 transition-colors hover:border-white hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <FormField label="Service ID" hint="lowercase, dot-separated">
            <input
              type="text"
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
              required
              placeholder="org.market.btc_spot"
              className={inputClass}
            />
          </FormField>

          <FormField label="Label" hint="optional">
            <input
              type="text"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="BTC spot price"
              className={inputClass}
            />
          </FormField>

          <FormField label="Endpoint URL" hint="https or http">
            <input
              type="url"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              required
              placeholder="https://api.vendor.example/spot"
              className={inputClass}
            />
          </FormField>

          <FormField label="Destination wallet" hint="Solana address">
            <input
              type="text"
              value={destinationAddress}
              onChange={(event) => setDestinationAddress(event.target.value)}
              required
              placeholder="MERCHANT_SOLANA_WALLET"
              className={inputClass}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Price" hint="PUSD">
              <input
                type="text"
                inputMode="decimal"
                value={expectedAmount}
                onChange={(event) => setExpectedAmount(event.target.value)}
                required
                placeholder="0.01"
                className={inputClass}
              />
            </FormField>

            <FormField label="Method">
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                className={inputClass}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </FormField>
          </div>

          {error && (
            <p className="border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-neutral-900 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs uppercase tracking-widest text-neutral-300 transition-colors hover:border-white hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="border border-white bg-white px-4 py-2 text-xs uppercase tracking-widest text-black transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Registering…' : 'Register'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
