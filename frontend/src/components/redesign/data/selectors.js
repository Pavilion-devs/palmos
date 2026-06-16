// Pure selectors mapping the real dashboard API payloads to the view-models the
// redesign components render. No JSX/icons here — components map a `type`/`tone`
// string to an icon/style. Replaces the previous hardcoded multi-chain placeholders
// with real Solana/PUSD data.

const CHAIN_LABELS = {
  'solana-mainnet': 'Solana',
  'solana-devnet': 'Solana (devnet)',
}

export function chainLabel(id) {
  if (!id) return '—'
  return CHAIN_LABELS[id] ?? id.replace(/-/g, ' ')
}

export function formatUsd(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '$0.00'
  const small = Math.abs(n) < 1000
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: small ? 2 : 0,
    maximumFractionDigits: small ? 2 : 0,
  })
}

export function formatTokenAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value ?? '')
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function truncateAddress(address) {
  if (!address) return '—'
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

function capitalize(value) {
  if (!value) return ''
  const s = String(value).replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function formatTime(iso) {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const date = new Date(ms)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? date.toLocaleTimeString('en-US', { hour12: false })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// --- agent snapshot → wallet roster / stats / controls -----------------------

function walletValueUsd(snap) {
  const positions = snap?.portfolio?.positions
  if (!Array.isArray(positions)) return 0
  return positions.reduce(
    (sum, p) => sum + (Number.isFinite(p?.value) ? p.value : 0),
    0,
  )
}

const STATUS_TONE = {
  // Operational (incl. operating under tighter limits) → active (lime)
  active: 'active',
  ready: 'active',
  active_limited: 'active',
  restricted: 'active',
  // Needs the operator's awareness → pending (amber)
  approval_pending: 'pending',
  pending: 'pending',
  stale: 'pending',
  // Not operational → blocked (red)
  blocked: 'blocked',
  disabled: 'blocked',
  failed: 'blocked',
}

function statusFor(snap) {
  const raw = snap?.agent?.status || snap?.agent?.walletState || 'unknown'
  return {
    tone: STATUS_TONE[raw] ?? 'pending',
    label: raw === 'active_limited' ? 'Limited' : capitalize(raw),
  }
}

function privacyOn(agent) {
  const mode = agent?.privacyMode ?? agent?.policyConfig?.privacyMode
  return mode === 'required' || mode === 'optional' || mode === 'allowed'
}

function railsFor(snap) {
  const pc = snap?.agent?.policyConfig ?? {}
  const asset = pc.allowedAssets?.[0] ?? 'PUSD'
  const rails = []
  if (pc.maxPerTransaction) {
    rails.push({ type: 'limit', label: `${formatTokenAmount(pc.maxPerTransaction)} ${asset}/tx` })
  }
  if (pc.allowedChains?.[0]) {
    rails.push({ type: 'chain', label: chainLabel(pc.allowedChains[0]) })
  }
  if (pc.allowedAssets?.[0]) {
    rails.push({ type: 'asset', label: pc.allowedAssets[0] })
  }
  if (privacyOn(snap?.agent)) {
    rails.push({ type: 'privacy', label: 'Private' })
  }
  return rails
}

export function selectWalletRows(agents = []) {
  return agents.map((snap) => ({
    agentId: snap?.agent?.agentId,
    name: snap?.agent?.displayName || snap?.agent?.agentId || 'Agent',
    address: truncateAddress(snap?.portfolio?.address || snap?.agent?.walletId),
    valueUsd: walletValueUsd(snap),
    value: formatUsd(walletValueUsd(snap)),
    rails: railsFor(snap),
    ...statusFor(snap),
  }))
}

export function assetsUnderControl(agents = []) {
  return agents.reduce((sum, snap) => sum + walletValueUsd(snap), 0)
}

export function activeWalletCount(agents = []) {
  return agents.filter((snap) => statusFor(snap).tone === 'active').length
}

export function selectControlRows(agents = []) {
  return agents.map((snap) => {
    const pc = snap?.agent?.policyConfig ?? {}
    const asset = pc.allowedAssets?.[0] ?? 'PUSD'
    return {
      agentId: snap?.agent?.agentId,
      name: snap?.agent?.displayName || 'Agent',
      perTx: pc.maxPerTransaction ? `${formatTokenAmount(pc.maxPerTransaction)} ${asset}` : '—',
      daily: pc.dailyLimit ? `${formatTokenAmount(pc.dailyLimit)} ${asset}` : '—',
      // Assets only — the chain (Solana / devnet) is implied by the asset, so we
      // don't surface redundant chain chips. Real per-agent policy assets.
      allowed: [...(pc.allowedAssets ?? [])],
      approval: pc.autoApproveUnder ? `> ${formatTokenAmount(pc.autoApproveUnder)} ${asset}` : '—',
      privacy: privacyOn(snap?.agent),
    }
  })
}

// --- transactions → activity rows --------------------------------------------

const TX_STATUS_TONE = {
  executed: 'executed',
  confirmed: 'executed',
  settled: 'executed',
  connected: 'executed',
  detected: 'executed',
  pending: 'pending',
  approval_pending: 'pending',
  waiting_for_execution: 'pending',
  proposed: 'pending',
  blocked: 'blocked',
  failed: 'blocked',
  denied: 'blocked',
}

function txType(tx) {
  const kind = `${tx?.actionRequestKind ?? ''} ${tx?.transactionKind ?? ''} ${tx?.eventType ?? ''}`.toLowerCase()
  if (kind.includes('connected')) return 'Agent'
  if (kind.includes('deposit')) return 'Deposit'
  if (kind.includes('transfer')) return 'Transfer'
  if (kind.includes('swap')) return 'Swap'
  if (kind.includes('liquidity')) return 'Liquidity'
  if (kind.includes('service') || kind.includes('paid_call') || kind.includes('pay')) return 'Payment'
  if (kind.includes('wallet')) return 'Wallet'
  return 'Action'
}

function txAmount(tx) {
  // tx.value is an object { assetSymbol, amount, ... } for wallet actions /
  // transfers / paid calls; fall back to a scalar tx.amount otherwise.
  const v = tx?.value
  const isObj = v && typeof v === 'object'
  const amount = isObj ? v.amount : (v ?? tx?.amount)
  if (amount == null || amount === '') return '—'
  const symbol = (isObj ? v.assetSymbol : undefined) ?? tx?.assetSymbol ?? tx?.asset ?? ''
  return `${formatTokenAmount(amount)} ${symbol}`.trim()
}

// Derive a Solscan link from whatever on-chain signature the row carries. Works for both the
// live `/api/dashboard/transactions` projection (transactionRef / broadcastRefs) and the static
// snapshot (pre-computed txExplorerUrl). Mirrors dashboardSnapshot's buildSolscanTxUrl.
const SOLANA_BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/

function txSignature(tx) {
  if (tx?.transactionRef) return tx.transactionRef
  if (tx?.txHashFull) return tx.txHashFull
  const refs = tx?.broadcastRefs
  if (Array.isArray(refs) && refs.length) return refs[refs.length - 1]
  return null
}

function buildTxExplorerUrl(signature, chainId) {
  if (!signature || typeof signature !== 'string' || signature.length < 80) return null
  if (!SOLANA_BASE58.test(signature) || chainId === 'solana-local') return null
  const cluster = chainId === 'solana-devnet' ? '?cluster=devnet' : ''
  return `https://solscan.io/tx/${signature}${cluster}`
}

export function selectActivityRows(transactions = []) {
  return transactions.map((tx) => ({
    id: tx?.id,
    title: tx?.title || capitalize(tx?.actionRequestKind) || 'Action',
    sub: tx?.summary || tx?.agentId || '',
    type: txType(tx),
    amount: txAmount(tx),
    status: capitalize(tx?.status),
    tone: TX_STATUS_TONE[tx?.status] ?? 'pending',
    time: formatTime(tx?.updatedAt || tx?.createdAt),
    txUrl: tx?.txExplorerUrl ?? buildTxExplorerUrl(txSignature(tx), tx?.value?.chainId ?? tx?.chainId),
    // Mantle decision-log link: the on-chain record of this governed decision + outcome.
    mantleTxUrl: tx?.mantle?.txUrl ?? tx?.mantleTxUrl ?? null,
    mantleOutcome: tx?.mantle?.outcome ?? tx?.mantleOutcome ?? null,
  }))
}

// --- approvals → needs-attention / approvals queue ---------------------------

export function selectPendingApprovals(approvals = []) {
  return approvals.map((a) => ({
    id: a?.executionId || a?.id || a?.actionRequestId,
    title: a?.title || capitalize(a?.actionRequestKind) || 'Pending approval',
    agent: a?.agentName || a?.agentId || '',
    amount: txAmount(a),
    reason: a?.reason || a?.approvalReason || a?.summary || 'Awaiting operator approval',
  }))
}
