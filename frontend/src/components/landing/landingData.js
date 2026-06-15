/**
 * Landing copy + structured content for the dark/lime PalmOS landing page.
 * Adapted from the editorial template's `lib/data.ts`, rewritten for PalmOS:
 * governed agent wallets (OWS keys, PUSD settlement, Byreal swaps, Mantle identity).
 */

export const WAITLIST_URL = 'https://tally.so/r/aQva1q'
export const DEMO_URL =
  'https://x.com/olathepavilion/status/2054172802278682936?s=20'
export const CONSOLE_URL = '/dashboard'

export const navLinks = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Capabilities', href: '#capabilities' },
  { label: 'Why PalmOS', href: '#why' },
]

/** Four-step product flow shown in the 2×2 "How it works" grid. */
export const steps = [
  {
    step: 'Step 01',
    title: 'Provision a wallet',
    description:
      'Spin up a non-custodial wallet for your agent in one click. Keys are generated and held in OWS vaults — never exposed to the agent, or to you.',
  },
  {
    step: 'Step 02',
    title: 'Set the policy',
    description:
      'Define spend caps, allowed vendors, and escalation thresholds in a live editor. The policy is enforced the moment you save.',
  },
  {
    step: 'Step 03',
    title: 'Agent executes',
    description:
      'The agent reads live wallet state and acts within policy — transfers, swaps, payments — proposing transactions your vault signs.',
  },
  {
    step: 'Step 04',
    title: 'Govern & audit',
    description:
      'Sensitive moves escalate to you for approval. Every decision — auto, approved, or blocked — lands in an immutable on-chain log.',
  },
]

/** Settlement targets rendered in the Step 04 visual. */
export const settlementRails = [
  { name: 'Solana · PUSD', note: 'Primary settlement rail', primary: true },
  { name: 'Mantle', note: 'Identity + decision log', primary: false },
  { name: 'Byreal', note: 'Cross-chain swap routing', primary: false },
]

/** Capability cards (replaces the template's prompt library). */
export const capabilities = [
  {
    index: '01',
    category: 'Payments',
    title: 'Governed payments',
    description:
      'Agents settle PUSD within policy. Spend caps, vendor allowlists, and per-call limits are checked before anything leaves the wallet.',
    icon: 'Wallet',
    badge: null,
  },
  {
    index: '02',
    category: 'Privacy',
    title: 'Private settlement',
    description:
      'Umbra stealth transfers keep counterparties and amounts off the public ledger — while staying fully auditable to you.',
    icon: 'EyeOff',
    badge: null,
  },
  {
    index: '03',
    category: 'Byreal',
    title: 'Cross-chain swaps',
    description:
      'Route swaps through Byreal on Solana. The agent proposes the trade; your vault signs it. No raw keys ever leave OWS.',
    icon: 'Repeat',
    badge: 'New',
  },
  {
    index: '04',
    category: 'Insight',
    title: 'Portfolio intelligence',
    description:
      'Agents read balances, positions, and on-chain flow before acting — every decision grounded in live, verifiable wallet state.',
    icon: 'LineChart',
    badge: null,
  },
  {
    index: '05',
    category: 'Mantle',
    title: 'On-chain identity',
    description:
      'ERC-8004 agent identity plus an immutable decision log on Mantle. Provable autonomy, provable accountability.',
    icon: 'BadgeCheck',
    badge: null,
  },
  {
    index: '06',
    category: 'Controls',
    title: 'Policy controls',
    description:
      'Set limits, escalation thresholds, and approval rules in a live editor. Sensitive moves route to you for sign-off.',
    icon: 'SlidersHorizontal',
    badge: null,
  },
]

/** "Why PalmOS" differentiation bento (4 cards). */
export const features = [
  {
    icon: 'Lock',
    title: 'Non-custodial by design',
    description:
      'Keys live in OWS hardware-backed vaults. Agents get authority, never the private key — and you can revoke access at any time.',
  },
  {
    icon: 'SlidersHorizontal',
    title: 'Structured policies',
    description:
      'Spend caps, vendor allowlists, and per-call limits expressed as enforceable rules the runtime checks on every action — not vibes.',
  },
  {
    icon: 'ScrollText',
    title: 'Full audit trail',
    description:
      'Every action, approval, and block is written on-chain. Provable accountability for autonomous agents, end to end.',
  },
  {
    icon: 'Zap',
    title: 'Real settlement',
    description:
      'Live on-chain settlement across Solana and Mantle from a single vault. Propose, approve, settle — in seconds.',
  },
]

/** Trust strip: built-with rails + headline stats (replaces testimonials). */
export const builtWith = [
  'OWS',
  'PUSD',
  'Byreal',
  'Mantle',
  'Solana',
  'XMTP',
  'Umbra',
]

export const stats = [
  { value: '0', label: 'Raw keys exposed to agents' },
  { value: '2', label: 'Chains settled from one vault' },
  { value: '100%', label: 'Decisions written on-chain' },
  { value: '24/7', label: 'Autonomous, always governed' },
]
