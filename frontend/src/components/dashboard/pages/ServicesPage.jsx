import { Plus } from 'lucide-react'
import { useState } from 'react'
import { navigate } from '../../../hooks/useHashRoute'
import RegisterServiceForm from '../RegisterServiceForm'

function ServiceCard({ service }) {
  const isRegistered = service.source === 'registered'
  return (
    <button
      type="button"
      onClick={() => navigate(`#dashboard/services/${service.serviceId}`)}
      className="flex w-full flex-col gap-3 border border-neutral-800 bg-neutral-950 p-5 text-left transition-colors hover:border-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[10px] uppercase tracking-widest text-neutral-400">
          {isRegistered ? 'registered' : 'built-in'}
        </span>
        <span className="font-mono text-xs text-white">{service.expectedAmount} PUSD</span>
      </div>
      <h3 className="line-clamp-2 text-base font-medium text-white">{service.label}</h3>
      <p className="truncate font-mono text-xs text-neutral-500">{service.serviceId}</p>
      <div className="grid grid-cols-2 gap-3 border-t border-neutral-900 pt-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-700">Vendor</div>
          <div className="mt-1 truncate font-mono text-xs text-neutral-400">{service.vendorId}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-700">Chain</div>
          <div className="mt-1 truncate font-mono text-xs text-neutral-400">{service.chainId}</div>
        </div>
      </div>
    </button>
  )
}

function Section({ title, count, services, emptyLabel }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[10px] uppercase tracking-widest text-neutral-500">{title}</h2>
        <span className="font-mono text-xs text-neutral-600">{count}</span>
      </div>
      {services.length === 0 ? (
        <div className="border border-dashed border-neutral-800 px-4 py-6">
          <p className="text-sm text-neutral-500">{emptyLabel}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {services.map((service) => (
            <ServiceCard key={service.serviceId} service={service} />
          ))}
        </div>
      )}
    </section>
  )
}

export default function ServicesPage({ services, registerService }) {
  const [registerOpen, setRegisterOpen] = useState(false)

  const registered = services.filter((service) => service.source === 'registered')
  const builtIn = services.filter((service) => service.source !== 'registered')

  const canRegister = Boolean(registerService)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-800 px-6 py-5">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-600">
            Service registry
          </div>
          <h1 className="mt-1 text-xl font-medium text-white">
            {services.length} {services.length === 1 ? 'service' : 'services'} available
          </h1>
        </div>
        {canRegister && (
          <button
            type="button"
            onClick={() => setRegisterOpen(true)}
            className="flex items-center gap-2 border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs uppercase tracking-widest text-white transition-colors hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Register service
          </button>
        )}
      </div>

      <div className="space-y-8 px-6 py-6">
        <Section
          title="Registered"
          count={registered.length}
          services={registered}
          emptyLabel="No services registered yet. Click Register service to add one."
        />

        <Section
          title="Built-in"
          count={builtIn.length}
          services={builtIn}
          emptyLabel="No built-in PalmOS services available."
        />
      </div>

      {registerOpen && canRegister && (
        <RegisterServiceForm
          onSubmit={registerService}
          onClose={() => setRegisterOpen(false)}
        />
      )}
    </div>
  )
}
