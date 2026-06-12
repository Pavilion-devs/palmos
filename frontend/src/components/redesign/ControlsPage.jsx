import { useState } from 'react'
import { Bot, Pencil } from 'lucide-react'
import { Shell } from './Shell'
import { useAgents } from '../../hooks/useAgents'
import { selectControlRows } from './data/selectors'
import { PolicyEditorDrawer } from './controls/PolicyEditorDrawer'

function Chip({ children, tone = 'muted' }) {
  const styles =
    tone === 'lime'
      ? 'bg-lime/15 text-lime border-transparent'
      : 'border-hairline bg-panel-2 text-muted-foreground'
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${styles}`}>{children}</span>
}

export function ControlsPage() {
  const { status, agents, refresh } = useAgents()
  const rows = selectControlRows(agents)
  const allowedRails = [...new Set(rows.flatMap((r) => r.allowed))]
  const [editingAgent, setEditingAgent] = useState(null)

  return (
    <Shell title="Controls">
      {/* Allowed rails across the workspace */}
      <section className="rounded-3xl bg-panel p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Allowed rails</h2>
            <p className="font-mono text-xs text-muted-foreground">
              Chains and assets your agents are permitted to operate
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {allowedRails.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No agents yet — rails apply when you connect your first agent.
            </p>
          ) : (
            allowedRails.map((d) => <Chip key={d}>{d}</Chip>)
          )}
        </div>
      </section>

      {/* Per-wallet rails */}
      <section className="flex min-h-0 flex-1 flex-col rounded-3xl bg-panel p-6">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Per-wallet rails</h2>

        <div className="mt-6 hidden grid-cols-[1.6fr_1fr_1fr_1.6fr_1fr_0.9fr_auto] items-center gap-4 px-2 pb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground lg:grid">
          <span>Agent</span>
          <span>Per-tx max</span>
          <span>Daily</span>
          <span>Allowed</span>
          <span>Approval over</span>
          <span>Privacy</span>
          <span className="sr-only">Edit</span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {status === 'loading' && (
            <div className="px-2 py-10 text-center text-sm text-muted-foreground">Loading controls…</div>
          )}
          {status === 'ready' && rows.length === 0 && (
            <div className="px-2 py-10 text-center text-sm text-muted-foreground">
              No agent wallets yet. Connect an agent to set its rails.
            </div>
          )}
          {rows.map((w, i) => (
            <div
              key={w.agentId}
              className={`grid grid-cols-1 items-center gap-4 px-2 py-4 lg:grid-cols-[1.6fr_1fr_1fr_1.6fr_1fr_0.9fr_auto] ${
                i !== 0 ? 'border-t border-hairline' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-lime text-primary-foreground">
                  <Bot className="size-4.5" strokeWidth={2} aria-hidden="true" />
                </div>
                <span className="text-sm font-semibold text-foreground">{w.name}</span>
              </div>
              <div className="font-mono text-sm text-foreground">{w.perTx}</div>
              <div className="font-mono text-sm text-foreground">{w.daily}</div>
              <div className="flex flex-wrap gap-2">
                {w.allowed.map((a) => (
                  <Chip key={a}>{a}</Chip>
                ))}
              </div>
              <div className="font-mono text-sm text-foreground">{w.approval}</div>
              <div>
                {w.privacy ? (
                  <Chip tone="lime">Private</Chip>
                ) : (
                  <span className="text-sm text-muted-foreground">Off</span>
                )}
              </div>
              <div className="flex lg:justify-end">
                <button
                  type="button"
                  onClick={() =>
                    setEditingAgent(
                      agents.find((a) => a?.agent?.agentId === w.agentId)
                        ?.agent ?? null,
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-panel-2/70"
                >
                  <Pencil className="size-3.5" strokeWidth={2} aria-hidden="true" />
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {editingAgent ? (
        <PolicyEditorDrawer
          agent={editingAgent}
          onClose={() => setEditingAgent(null)}
          onSaved={() => refresh?.()}
        />
      ) : null}
    </Shell>
  )
}
