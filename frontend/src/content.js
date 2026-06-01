export const navLinks = [
  { label: 'Product', href: '#product' },
  { label: 'Controls', href: '#controls' },
  { label: 'Workflows', href: '#workflows' },
  { label: 'Integrations', href: '#integrations' },
]

export const howItWorksSteps = [
  {
    step: '01',
    title: 'Understand',
    description: 'Agents read balances, positions, and wallet activity before acting',
    icon: 'Wallet',
  },
  {
    step: '02',
    title: 'Execute',
    description: 'Agents act within policy — transfers, trades, rebalances, payments',
    icon: 'ShieldCheck',
  },
  {
    step: '03',
    title: 'Govern',
    description: 'Sensitive moves escalate for approval. Every decision leaves an audit trail',
    icon: 'Eye',
  },
]

export const outcomeCards = [
  {
    status: 'Auto Approved',
    color: 'green',
    agent: 'Portfolio Monitor Agent',
    action: 'On-chain flow intelligence report',
    amount: '0.02 PUSD',
    policy: 'Within spend limit and allowed service scope — executed automatically',
  },
  {
    status: 'Pending Approval',
    color: 'yellow',
    agent: 'Treasury Operations Agent',
    action: 'DeFi protocol risk assessment',
    amount: '0.25 PUSD',
    policy: 'Exceeds auto-approve threshold — routed to operator for review',
  },
  {
    status: 'Policy Blocked',
    color: 'red',
    agent: 'External Research Agent',
    action: 'Unregistered vendor endpoint',
    amount: '0.50 PUSD',
    policy: 'No allowed vendor or destination resolved — blocked before execution',
  },
]

export const builtWithLogos = [
  { name: 'OWS', label: 'OWS' },
  { name: 'PUSD', label: 'Palm USD' },
  { name: 'XMTP', label: 'XMTP' },
  { name: 'Umbra', label: 'Umbra' },
  { name: 'Solana', label: 'Solana' },
]
