/**
 * Hand-written ABIs (as const, for viem type inference) for the two PalmOS Mantle contracts.
 * Mirror contracts/src/*.sol — kept in sync with the compiled artifacts in contracts/out/.
 */

export const IDENTITY_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentCardURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'setAgentCard',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'agentCardURI', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'agentIdOf',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'agentCardURI', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const

export const AGENT_ACTION_LOG_ABI = [
  {
    type: 'function',
    name: 'recordDecision',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'actionId', type: 'bytes32' },
      { name: 'kind', type: 'string' },
      { name: 'verdict', type: 'string' },
      { name: 'outcome', type: 'string' },
      { name: 'solanaSignature', type: 'string' },
      { name: 'amount', type: 'uint256' },
      { name: 'detail', type: 'string' },
    ],
    outputs: [{ name: 'seq', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'recordCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'DecisionRecorded',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'actionId', type: 'bytes32', indexed: true },
      { name: 'seq', type: 'uint256', indexed: true },
      { name: 'kind', type: 'string', indexed: false },
      { name: 'verdict', type: 'string', indexed: false },
      { name: 'outcome', type: 'string', indexed: false },
      { name: 'solanaSignature', type: 'string', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'detail', type: 'string', indexed: false },
    ],
  },
] as const
