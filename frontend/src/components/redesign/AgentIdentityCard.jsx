import { Fingerprint, ExternalLink, ArrowLeftRight, Droplets } from 'lucide-react'

function shortHex(value, tail = 4) {
  if (!value || typeof value !== 'string') return ''
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-tail)}` : value
}

function functionalityIcon(id = '') {
  if (id.includes('liquidity')) return Droplets
  return ArrowLeftRight
}

function DetailRow({ label, value, href }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-sm text-foreground transition-colors hover:text-lime"
        >
          {value}
          <ExternalLink className="size-3" strokeWidth={2} aria-hidden="true" />
        </a>
      ) : (
        <span className="font-mono text-sm text-foreground">{value}</span>
      )}
    </div>
  )
}

/**
 * The agent's ERC-8004 identity on Mantle: the minted identity NFT (agent card) + the registry and
 * decision-log contracts. Renders only once contracts are deployed (and ideally minted); stays
 * hidden otherwise so the overview is never cluttered with an empty shell.
 */
export function AgentIdentityCard({ mantle }) {
  if (!mantle || (!mantle.agent && !mantle.identityRegistry)) {
    return null
  }
  const agent = mantle.agent
  const card = agent?.card
  const explorer = (mantle.explorer || '').replace(/\/$/, '')
  const addressUrl = (addr) => (explorer && addr ? `${explorer}/address/${addr}` : undefined)
  const functionalities = Array.isArray(card?.functionalities) ? card.functionalities : []
  const solanaAddress = agent?.solanaPaymentAddress

  return (
    <section className="flex flex-col rounded-3xl bg-panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-panel-2 text-lime">
            <Fingerprint className="size-5" strokeWidth={2} aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {card?.name ?? 'Agent'} identity
            </h2>
            <p className="text-xs text-muted-foreground">
              ERC-8004 · Mantle Sepolia · one vault, two chains
            </p>
          </div>
        </div>
        {agent?.tokenUrl && (
          <a
            href={agent.tokenUrl}
            target="_blank"
            rel="noreferrer"
            title="View identity NFT on Mantle"
            className="inline-flex items-center gap-1.5 rounded-full bg-lime/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-lime transition-colors hover:bg-lime/20"
          >
            NFT #{agent.agentId}
            <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </a>
        )}
      </div>

      {functionalities.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {functionalities.map((fn) => {
            const Icon = functionalityIcon(fn.id)
            return (
              <span
                key={fn.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-3 py-1 text-xs text-foreground"
              >
                <Icon className="size-3.5 text-lime" strokeWidth={2} aria-hidden="true" />
                {fn.name ?? fn.id}
              </span>
            )
          })}
        </div>
      )}

      <div className="mt-4 divide-y divide-hairline border-t border-hairline">
        {agent?.owner && (
          <DetailRow label="Identity owner (Mantle)" value={shortHex(agent.owner)} href={addressUrl(agent.owner)} />
        )}
        {solanaAddress && (
          <DetailRow
            label="Pays to (Solana)"
            value={shortHex(solanaAddress)}
            href={`https://solscan.io/account/${solanaAddress}`}
          />
        )}
        {mantle.identityRegistry && (
          <DetailRow
            label="Identity registry"
            value={shortHex(mantle.identityRegistry)}
            href={addressUrl(mantle.identityRegistry)}
          />
        )}
        {mantle.actionLog && (
          <DetailRow
            label="Decision log"
            value={shortHex(mantle.actionLog)}
            href={addressUrl(mantle.actionLog)}
          />
        )}
      </div>
    </section>
  )
}
