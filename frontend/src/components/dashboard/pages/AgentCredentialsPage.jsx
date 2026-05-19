import { ArrowLeft } from 'lucide-react'
import { navigate } from '../../../hooks/useHashRoute'
import CredentialsManager from '../CredentialsManager'

function NotFound({ agentId }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-neutral-600">
          Agent not found
        </div>
        <h2 className="text-lg font-medium text-white">No agent matches this id</h2>
        <p className="mt-3 break-all text-sm text-neutral-500">{agentId}</p>
        <button
          type="button"
          onClick={() => navigate('#dashboard/agents')}
          className="mt-5 inline-flex items-center gap-2 border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs uppercase tracking-widest text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to agents
        </button>
      </div>
    </div>
  )
}

export default function AgentCredentialsPage({
  agentId,
  agents,
  listAgentCredentials,
  createAgentCredential,
  revokeAgentCredential,
  updateAgentCredential,
  rotateAgentCredential,
}) {
  const agent = agents.find((item) => item.id === agentId)

  if (!agent) {
    return <NotFound agentId={agentId} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-b border-neutral-800 px-6 py-5">
        <button
          type="button"
          onClick={() => navigate(`#dashboard/agents/${agent.id}`)}
          className="mb-4 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-neutral-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back to agent
        </button>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-neutral-600">
            SDK credentials
          </div>
          <h1 className="mt-1 text-2xl font-medium text-white">{agent.name}</h1>
          <p className="mt-1 truncate font-mono text-[11px] text-neutral-500">
            {agent.id}
          </p>
        </div>
      </div>

      <div className="px-6 py-5">
        <section className="border border-neutral-800 bg-neutral-950">
          <div className="p-5">
            {listAgentCredentials && createAgentCredential && revokeAgentCredential ? (
              <CredentialsManager
                agentId={agent.id}
                listAgentCredentials={listAgentCredentials}
                createAgentCredential={createAgentCredential}
                revokeAgentCredential={revokeAgentCredential}
                updateAgentCredential={updateAgentCredential}
                rotateAgentCredential={rotateAgentCredential}
                mode="full"
              />
            ) : (
              <p className="text-xs text-neutral-500">
                Credential management is unavailable in offline mode.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
