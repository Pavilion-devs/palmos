import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAgents } from '../../hooks/useAgents'
import { selectWalletRows } from './data/selectors'
import { Shell } from './Shell'
import { WalletsTable } from './WalletsTable'

export function WalletsPage() {
  const navigate = useNavigate()
  const { agents } = useAgents()
  const rows = selectWalletRows(agents)
  const active = rows.filter((w) => w.tone === 'active').length
  const pending = rows.filter((w) => w.tone === 'pending').length
  const blocked = rows.filter((w) => w.tone === 'blocked').length

  return (
    <Shell title="Wallet Control">
      {/* Slim summary + action bar. The three big stat cards live on Overview now,
          so the Wallets page leads with the roster + a Connect agent action. Each
          row is an agent + its wallet; adding one starts with connecting the agent. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-mono font-semibold text-foreground">{rows.length}</span>{' '}
          wallet{rows.length === 1 ? '' : 's'}
          {active > 0 && (
            <>
              <span className="mx-2 text-hairline">·</span>
              <span className="text-lime">{active} active</span>
            </>
          )}
          {pending > 0 && (
            <>
              <span className="mx-2 text-hairline">·</span>
              <span className="text-pending">{pending} pending</span>
            </>
          )}
          {blocked > 0 && (
            <>
              <span className="mx-2 text-hairline">·</span>
              <span className="text-blocked">{blocked} blocked</span>
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => navigate('/dashboard/connect')}
          className="inline-flex items-center gap-2 self-start rounded-full bg-lime px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 sm:self-auto"
        >
          <Plus className="size-4" strokeWidth={2.5} aria-hidden="true" />
          Connect agent
        </button>
      </div>

      <WalletsTable />
    </Shell>
  )
}
