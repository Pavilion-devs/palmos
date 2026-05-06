import useNow from '../../hooks/useNow'

export default function PolicyInspector({ agents, selectedAgentId, onSelectAgent }) {
  const now = useNow(1000)
  const agent = agents.find((a) => a.id === selectedAgentId) || agents[0]

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="mb-1 text-sm text-neutral-500">No agent policy loaded</p>
          <p className="text-xs text-neutral-700">Start the worker to inspect backend policy state</p>
        </div>
      </div>
    )
  }

  const policy = agent.policy
  const secondsSinceCheckIn = agent.lastCheckIn
    ? Math.floor((now - agent.lastCheckIn) / 1000)
    : null
  const budgetPercent = policy.sessionBudget
    ? Math.min(100, (policy.sessionSpent / policy.sessionBudget) * 100)
    : 0

  return (
    <div className="p-5">
      <div className="mb-6 flex items-center gap-3">
        <span className="text-[10px] uppercase tracking-widest text-neutral-600">Inspect:</span>
        <select
          value={agent.id}
          onChange={(e) => onSelectAgent(e.target.value)}
          className="border border-neutral-800 bg-neutral-900 px-3 py-1.5 font-mono text-xs text-white focus:border-neutral-600 focus:outline-none"
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PolicyBlock label="Spend Envelope">
          <PolicyRow label="Session budget" value={policy.sessionBudgetDisplay} />
          <PolicyRow label="Committed spend" value={`${policy.sessionSpent.toFixed(3)} PUSD`} />
          <PolicyRow label="Remaining budget" value={`${policy.sessionRemaining.toFixed(3)} PUSD`} accent />
          <PolicyRow label="Executed spend" value={`${policy.executedSpend.toFixed(3)} PUSD`} />
          <div className="mt-2 h-1.5 w-full bg-neutral-800">
            <div
              className="h-full bg-neutral-400 transition-all duration-500"
              style={{ width: `${budgetPercent}%` }}
            />
          </div>
        </PolicyBlock>

        <PolicyBlock label="Chain Restrictions">
          <PolicyRow label="Allowed" value={policy.chain} />
        </PolicyBlock>

        <PolicyBlock label="Vendor Allowlist">
          <div className="flex flex-wrap gap-1.5">
            {policy.vendors.map((v) => (
              <span key={v} className="border border-neutral-800 bg-neutral-900 px-2 py-0.5 font-mono text-[10px] text-neutral-400">
                {v}
              </span>
            ))}
          </div>
        </PolicyBlock>

        <PolicyBlock label="Spend Thresholds">
          <PolicyRow label="Max per call" value={policy.maxPerCallDisplay} />
          <PolicyRow label="Auto-approve" value={`<= ${policy.autoApproveMax.toFixed(2)} PUSD`} />
          <PolicyRow label="Approval required" value={policy.approvalRange} />
          <PolicyRow label="Hard block" value={policy.hardBlock} warn />
        </PolicyBlock>

        <PolicyBlock label="Dead-Man's Switch">
          <PolicyRow label="Timeout" value={`Revoke if no check-in > ${policy.deadManSwitch}`} />
          <PolicyRow label="Last check-in" value={secondsSinceCheckIn != null ? `${secondsSinceCheckIn}s ago` : 'Never'} />
        </PolicyBlock>

        <PolicyBlock label="Wallet Access">
          <PolicyRow label="Backend" value={String(policy.walletBackend ?? 'runtime').toUpperCase()} />
          <PolicyRow label="OWS wallet" value={policy.owsWalletName ?? 'Not attached'} />
          <PolicyRow label="API key" value={policy.apiKeyId ?? 'Not issued'} />
          <PolicyRow label="Wallet state" value={String(policy.walletState ?? 'unknown').toUpperCase()} />
        </PolicyBlock>

        <PolicyBlock label="Onchain Context">
          <PolicyRow
            label="Zerion wallet"
            value={shortenAddress(policy.zerionWalletAddress)}
          />
          <PolicyRow
            label="Sync status"
            value={policy.zerionSyncMessage ?? 'Unavailable'}
          />
          <PolicyRow
            label="Portfolio value"
            value={policy.zerionPortfolioDisplay ?? 'Unavailable'}
          />
          <PolicyRow
            label="Positions"
            value={String(policy.zerionPositionsCount ?? 0)}
          />
          <PolicyRow
            label="Recent transactions"
            value={String(policy.zerionTransactionsCount ?? 0)}
          />
          <PolicyRow
            label="Latest tx"
            value={policy.zerionLatestDisplay ?? 'Unavailable'}
          />
        </PolicyBlock>

        <PolicyBlock label="Trust & Alerts">
          <PolicyRow label="Current tier" value={agent.trustTier.toUpperCase()} />
          <PolicyRow label="Agent status" value={agent.status.toUpperCase()} />
          <PolicyRow label="Blocked calls" value={String(policy.blockedCount ?? 0)} warn={Boolean(policy.blockedCount)} />
          <PolicyRow label="Latest outcome" value={policy.latestOutcome} accent />
          {policy.latestErrorCode && (
            <PolicyRow label="Latest error" value={policy.latestErrorCode} warn />
          )}
          <PolicyRow label="XMTP alerts" value={String(policy.xmtpAlertCount ?? 0)} />
          <PolicyRow label="Latest XMTP" value={policy.latestXmtpType ?? 'none'} />
        </PolicyBlock>
      </div>
    </div>
  )
}

function PolicyBlock({ label, children }) {
  return (
    <div className="border border-neutral-800 p-4">
      <div className="mb-3 text-[10px] font-medium uppercase tracking-widest text-neutral-600">{label}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function PolicyRow({ label, value, accent, warn }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-neutral-500">{label}</span>
      <span
        className={`font-mono text-xs ${warn ? 'text-red-400' : accent ? 'text-white' : 'text-neutral-300'}`}
      >
        {value}
      </span>
    </div>
  )
}

function shortenAddress(value) {
  if (!value) {
    return 'Unavailable'
  }

  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}
