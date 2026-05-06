export const navLinks = [
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Outcomes', href: '#outcomes' },
  { label: 'Stack', href: '#built-with' },
]

export const howItWorksSteps = [
  {
    step: '01',
    title: 'Assign',
    description: 'Give agents wallets with rules',
    icon: 'Wallet',
  },
  {
    step: '02',
    title: 'Operate',
    description: 'Agents spend autonomously within policy',
    icon: 'ShieldCheck',
  },
  {
    step: '03',
    title: 'Govern',
    description: 'You approve, deny, and audit in real time',
    icon: 'Eye',
  },
]

export const outcomeCards = [
  {
    status: 'Auto Approved',
    color: 'green',
    agent: 'Research Agent',
    action: 'Market data via PUSD API',
    amount: '0.03 PUSD',
    policy: 'Within OWS-backed policy guardrails - auto-approved',
  },
  {
    status: 'Pending Approval',
    color: 'yellow',
    agent: 'Ops Buyer',
    action: 'Ops brief via PalmOS merchant',
    amount: '0.25 PUSD',
    policy: 'Exceeds the 0.10 PUSD auto-approve threshold - awaiting operator',
  },
  {
    status: 'Policy Denied',
    color: 'red',
    agent: 'Growth Agent',
    action: 'Unknown paid endpoint',
    amount: '0.25 PUSD',
    policy: 'No allowed vendor or Solana destination resolved - blocked',
  },
]

export const builtWithLogos = [
  { name: 'OWS', label: 'OWS' },
  { name: 'PUSD', label: 'Palm USD' },
  { name: 'XMTP', label: 'XMTP' },
  { name: 'OpenAI', label: 'OpenAI' },
  { name: 'Solana', label: 'Solana' },
  { name: 'Zerion', label: 'Zerion' },
]
